FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY afula_mcp.py .

ENV MCP_TRANSPORT=streamable-http
# Cloud Run sets PORT automatically; 8080 is its default.
ENV PORT=8080

EXPOSE 8080

CMD ["python", "afula_mcp.py"]
