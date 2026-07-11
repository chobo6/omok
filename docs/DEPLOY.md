# 배포 — 로컬 쿠버네티스(kind) 실습

> **버전**: 1.0
> **작성일**: 2026-07-12

---

## 1. 배경 및 목표

쿠버네티스 실습을 목적으로 로컬 [kind](https://kind.sigs.k8s.io/)(Kubernetes in Docker) 클러스터에 먼저 배포한다. 이후 AWS EKS로 이전할 계획이나, EKS는 컨트롤플레인만으로 월 $73 고정 비용이 발생해 학습 목적이 아니면 이 프로젝트 규모엔 과함 — kind로 핵심 개념(Deployment/Service/ConfigMap/Secret/StatefulSet/PVC)을 먼저 익히고, EKS는 AWS 고유 통합(IRSA, ALB Controller, EBS CSI 등)만 짧게 켰다 끄는 방식으로 실습할 예정.

## 2. 핵심 제약

**방/게임 상태가 서버 메모리(`Map`)에만 저장되는 구조**(루트 `CLAUDE.md` 참고)라, Deployment의 `replicas`는 **반드시 1**로 고정한다. 여러 개로 늘리면 방 상태가 파드별로 갈라진다. 나중에 EKS로 옮겨도 이 제약은 동일하게 적용된다(Socket.io Redis 어댑터 + 상태 외부화 리팩터 없이는 수평 확장 불가).

Postgres는 kind 실습 단계에서는 **인클러스터 StatefulSet**으로 운영한다(실습용 더미 데이터라 리스크 없음, PVC/StorageClass 학습 목적). 실제 서비스라면 RDS처럼 클러스터 밖 관리형 DB를 쓰는 게 표준 패턴.

## 3. 아키텍처 (kind 단계)

```
브라우저 (localhost)
    │  kubectl port-forward (1차) / ingress-nginx (2차, 예정)
    ▼
Service: omok-server (ClusterIP)
    ▼
Deployment: omok-server (replicas=1)
    │  ├─ Express가 정적 파일(client 빌드 결과물) 서빙
    │  ├─ REST API (/api/*)
    │  └─ Socket.io (/socket.io)
    ▼
Service: omok-postgres (headless, clusterIP: None)
    ▼
StatefulSet: omok-postgres (PVC ← kind 기본 local-path StorageClass)
```

## 4. 사전 준비물

- Docker Desktop (kind가 노드를 도커 컨테이너로 띄우는 데 필요)
- `kubectl`
- `kind` (winget으로 설치. Windows에서 winget 설치 직후엔 PATH가 이미 켜진 세션에 반영이 안 될 수 있어, 새 터미널을 열거나 세션마다 PATH에 설치 경로를 임시로 추가해야 할 수 있음)

## 5. 레포 파일 구성

| 파일 | 역할 |
|---|---|
| `Dockerfile` (루트) | 멀티스테이지 빌드 — 1단계에서 client(Vite) 빌드, 2단계에서 server 이미지에 그 결과물만 복사해 넣음. `VITE_GOOGLE_CLIENT_ID`는 build-arg로 주입(Vite 환경변수는 빌드 타임에 번들에 박히므로 런타임 env로는 못 바꿈) |
| `.dockerignore` | `node_modules`, `.env` 등 이미지에 안 들어가야 할 것 제외 |
| `kind-config.yaml` (루트) | **쿠버네티스 리소스가 아니라 kind 도구 자체의 클러스터 설정**(노드 개수 등). `k8s/` 안에 두면 `kubectl apply -f k8s/`가 이것도 리소스로 착각해 에러 남 — 그래서 루트에 별도로 둠 |
| `k8s/00-namespace.yaml` | 전용 `omok` 네임스페이스 |
| `k8s/10-postgres-secret.yaml.example` → 실제 `k8s/10-postgres-secret.yaml`(gitignore됨, 직접 만들어야 함) | Postgres 계정/비밀번호 (Secret) |
| `k8s/11-postgres-service.yaml` | Postgres headless Service (StatefulSet 파드를 이름으로 직접 찾아가기 위함) |
| `k8s/12-postgres-statefulset.yaml` | Postgres StatefulSet + PVC 템플릿(1Gi) |
| `k8s/20-server-configmap.yaml` | server의 비민감 설정(NODE_ENV, PORT, CLIENT_ORIGIN, PGSSL) |
| `k8s/21-server-secret.yaml.example` → 실제 `k8s/21-server-secret.yaml`(gitignore됨, 직접 만들어야 함) | server의 민감 설정(SESSION_JWT_SECRET, DATABASE_URL) |
| `k8s/22-server-deployment.yaml` | server Deployment. `replicas: 1` 고정, `imagePullPolicy: Never`(레지스트리 없이 `kind load docker-image`로 넣은 이미지를 그대로 씀), readiness/liveness probe는 기존 `GET /api/rooms` 재활용 |
| `k8s/23-server-service.yaml` | server ClusterIP Service |

파일명 앞 번호(`00-`, `10-`, `20-`...)는 `kubectl apply -f k8s/`가 적용하는 순서를 보장하기 위함(네임스페이스가 먼저 있어야 나머지가 그 안에 들어갈 수 있음).

## 6. 코드 변경 사항

- `server/index.js` — `PORT`를 `process.env.PORT || 4000`으로 환경변수화. `express.static`으로 빌드된 client(`public/`) 서빙 + `/api`·`/socket.io`가 아닌 GET 요청은 `index.html`로 폴백하는 라우트 추가(Express 5부터 `app.get('*', ...)`가 안 먹혀 정규식 라우트 사용)
- `server/db/pool.js` — `PGSSL=true`일 때만 SSL 접속하도록 분기. 로컬/인클러스터 Postgres는 SSL 없이, 나중에 RDS로 옮길 때는 `PGSSL=true`만 설정하면 되도록 미리 대비

## 7. 재현 절차

```bash
# 0. Secret 파일 준비 (.example을 복사해 실제 값 채우기 — 이 둘은 .gitignore 대상이라 저장소엔 없음)
cp k8s/10-postgres-secret.yaml.example k8s/10-postgres-secret.yaml
cp k8s/21-server-secret.yaml.example k8s/21-server-secret.yaml
# 위 두 파일을 열어 change-me 부분을 실제 값으로 채운다
# (SESSION_JWT_SECRET은 예: openssl rand -hex 32 로 생성)

# 1. 이미지 빌드
docker build -t omok-server:local .

# 2. kind 클러스터 생성
kind create cluster --config kind-config.yaml

# 3. 이미지를 클러스터 노드 안으로 직접 로드 (레지스트리 없이)
kind load docker-image omok-server:local --name omok

# 4. 매니페스트 적용
kubectl apply -f k8s/

# 5. 상태 확인
kubectl get all -n omok

# 6. 로컬 포트로 터널링해서 접속 확인
kubectl port-forward -n omok svc/omok-server 4000:4000
# → 브라우저에서 http://localhost:4000
```

## 8. Secret 파일 취급 주의

`k8s/10-postgres-secret.yaml`, `k8s/21-server-secret.yaml`은 **`.gitignore`에 등록되어 있어 저장소에 커밋되지 않는다**(`.example` 템플릿만 커밋됨) — 이 레포는 공개 저장소라, 로컬 kind 클러스터 전용이라도 실제 값이 든 Secret YAML을 커밋하면 git 히스토리에 영구히 남는다. `server/.env`가 `.env.example`과 분리돼 있는 것과 동일한 이유다. 나중에 EKS 단계에서도 이 패턴을 유지하고, 실서비스 시크릿은 `kubectl create secret` 커맨드나 AWS Secrets Manager 연동으로 대체하는 걸 권장.

## 9. 알려진 제약 / 생략한 것 (1차 실습 범위)

- **Google 로그인 미설정** — `k8s/21-server-secret.yaml`에 `GOOGLE_CLIENT_ID`가 없음. 게스트 모드(공개방/AI 대전)는 정상 동작하지만 랭킹전은 로그인 필요라 이 단계에선 검증 안 됨
- **DB 마이그레이션 미실행** — Postgres는 떠 있지만 `schema.sql`을 아직 안 넣음. 랭킹전을 테스트하려면 `kubectl exec -n omok omok-postgres-0 -- psql -U omok -d omok` 등으로 직접 적용 필요
- **Ingress 미설치** — `kubectl port-forward`로만 접근 가능. 다음 단계에서 ingress-nginx(Helm)로 대체 예정
- **전부 로컬 PC에서만 동작** — docker-compose로 돌리던 것과 마찬가지로 인터넷에 노출된 적이 없음. 이 kind 클러스터는 "배포"가 아니라 쿠버네티스 조작을 손에 익히는 연습 환경. 컴퓨터를 끄면 그대로 사라짐(단, `kind create cluster`로 재생성 가능)

## 10. 다음 단계

1. `ingress-nginx`(Helm) 설치 → `k8s/`에 Ingress 리소스 추가, port-forward 대신 사용
2. (이후, 별도 단계) AWS EKS로 이전 — Postgres를 RDS로, Ingress를 ALB로, 이미지 배포를 ECR로 교체. 이 문서의 Dockerfile과 대부분의 `k8s/` 매니페스트는 그대로 재사용 가능하도록 설계함 (SSL 분기, PORT 환경변수화가 이를 위한 사전 작업)
