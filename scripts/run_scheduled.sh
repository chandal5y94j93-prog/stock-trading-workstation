#!/bin/bash
# Scheduled local run: choose session by current hour, run pipeline, push updates.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
H="$(date +%H)"
if [ "$H" = "08" ]; then
  SESSION="pre-market"
elif [ "$H" = "12" ]; then
  SESSION="midday"
else
  SESSION="evening"
fi
mkdir -p "$REPO/logs"
{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') $SESSION ===="
  /usr/bin/python3 "$REPO/scripts/pipeline.py" \
    --session "$SESSION" \
    --repo "$REPO" \
    --ths-plist "/Users/kangchengdong/Library/Group Containers/74EG3R33SN.group.SharedDefaults/Library/Preferences/74EG3R33SN.group.SharedDefaults.plist" \
    --push
} >> "$REPO/logs/run.log" 2>&1
