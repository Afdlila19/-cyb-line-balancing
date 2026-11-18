FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY public ./public
ENV CYB_DATA_DIR=/data \
    PYTHONUNBUFFERED=1
RUN mkdir -p /data && useradd -r -u 10001 cyb && chown cyb /data
USER cyb
EXPOSE 8080
CMD ["python", "server.py"]
