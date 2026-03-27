#!/bin/bash
# GitPulse startup script
# Usage: ./start.sh [--prod]

set -e

if [ "$1" = "--prod" ]; then
  echo "Building for production..."
  cd client && npm run build && cd ..
  echo "Starting production server..."
  cd server && npm start
else
  echo "Starting GitPulse in development mode..."
  echo "  API:      http://localhost:3001"
  echo "  Frontend: http://localhost:5173"
  echo ""
  # Start both concurrently
  (cd server && npx tsx src/index.ts &)
  (cd client && npx vite &)
  wait
fi
