#!/usr/bin/env bash
# รัน k6 หนึ่งชุด + เก็บ summary JSON และสถิติ CPU/RAM ระหว่างรัน
# ใช้: bash run.sh <ชื่อผล> <สคริปต์.js> [k6 args...]  (ดู README.md)
# k6 ไม่อยู่ใน PATH ให้ตั้ง K6=<path ของ k6>
set -u
D="$(cd "$(dirname "$0")" && pwd)"
NAME="$1"; SCRIPT="$2"; shift 2
mkdir -p "$D/results"
# .env ของ repo (โฟลเดอร์บนสุด) — เปลี่ยนได้ด้วย ENV_FILE=...
ENV_FILE="${ENV_FILE:-$D/../../../.env}"
# ส่งรหัสผ่านผู้ใช้ทดสอบให้ k6 ทาง env (k6 อ่านเป็น __ENV.PASSWORD) ไม่ใส่ในอาร์กิวเมนต์
# ที่คนอื่นบนเครื่องเดียวกันเห็นได้จากรายการ process
export PASSWORD=$(grep -E '^TEST_USERS_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
PID=$(netstat -ano | grep -E ':3002 .*LISTENING' | awk '{print $NF}' | head -1)
# sampler: ทุก 5 วิ — CPU% ของ postgres (docker) + CPU วินาทีสะสม/RAM ของ node backend
(
  echo "time,pg_cpu,pg_mem,node_cpu_sec,node_ws_mb" > "$D/results/$NAME-stats.csv"
  while true; do
    PG=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' gps-postgres | sed 's/ \/.*//')
    NODE=$(powershell.exe -NoProfile -Command "\$p=Get-Process -Id $PID; '{0:F1},{1:F0}' -f \$p.CPU, (\$p.WorkingSet64/1MB)" | tr -d '\r')
    echo "$(date +%H:%M:%S),$PG,$NODE" >> "$D/results/$NAME-stats.csv"
    sleep 5
  done
) &
SAMPLER=$!
"${K6:-k6}" run --quiet --summary-export "$D/results/$NAME-summary.json" "$@" "$D/$SCRIPT" > "$D/results/$NAME-k6.txt" 2>&1
RC=$?
kill $SAMPLER 2>/dev/null
echo "k6 exit=$RC  ผล: results/$NAME-k6.txt"
