#!/bin/bash
cd "$(dirname "$0")"
pip install -r backend/requirements.txt -q
cd backend
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
