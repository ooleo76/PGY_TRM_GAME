# ══════════════════════════════════════════════════════════════
#  IHCA 團隊復甦模擬器 — 容器映像檔
#  給 Fly.io 等平台用。Render 走 Node 模式，不需要這個檔案。
#
#  ★ 這個檔案刻意放在 extras/ 而不是根目錄：
#    Render 只要在 repo 根目錄看到 Dockerfile，就會自動把 Language
#    切成 Docker，Build Command / Start Command 兩格會整個消失。
#    放在子資料夾就不會觸發。
#
#  build context 是 repo 根目錄，所以要從根目錄執行：
#    docker build -f extras/Dockerfile -t ihca .
# ══════════════════════════════════════════════════════════════
FROM node:20-alpine

WORKDIR /app

# 專案沒有任何外部套件（package.json 只宣告 engines 與 scripts），
# 所以不需要 npm install，直接複製原始碼即可。
COPY . .

# Git 不追蹤空資料夾，映像檔裡可能沒有 recordings/。
# server.js 啟動時會自己補建，這裡先建好是多一層保險。
RUN mkdir -p /app/recordings

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# 不用 root 跑（node 映像檔內建 node 這個使用者）
RUN chown -R node:node /app
USER node

CMD ["node","server.js"]
