# ── 1단계: client 빌드 ── 이 스테이지 결과물(정적 파일)만 다음 단계로 넘기고 버림
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
# client는 Windows에서 만든 package-lock.json에 Linux(alpine)용 네이티브 바이너리
# optional dependency(rolldown/oxlint 등) 항목이 빠져있어 npm ci가 실패한다 —
# npm install로 완화(재현성은 약간 떨어지지만 이 틈새를 그때그때 보완해 설치함)
RUN npm install
COPY client/ ./
# Vite 환경변수는 빌드 타임에 번들에 박히므로 런타임 env로는 못 바꾼다.
# 1차 실습(Google 로그인 생략)에서는 비워둬도 게스트 모드는 정상 동작한다.
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# ── 2단계: server 실행 이미지 ──
FROM node:20-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client-build /app/client/dist ./public
EXPOSE 4000
CMD ["node", "index.js"]
