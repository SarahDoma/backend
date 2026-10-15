# Distributed tracing

OpenTelemetry tracing is disabled by default. Set `OTEL_TRACING_ENABLED=true`
to create HTTP, Express, and NestJS spans and export them using OTLP/HTTP.
The exporter defaults to `http://localhost:4318/v1/traces`. Point it at your
collector with `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; optionally set
`OTEL_SERVICE_NAME` (default `stellar-tickets-backend`).

```env
OTEL_TRACING_ENABLED=true
OTEL_SERVICE_NAME=stellar-tickets-backend
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
```

Start an OTLP-compatible collector before starting the API. In containers,
`localhost` refers to the API container, so use your collector's service name.
Incoming W3C `traceparent` headers are propagated and outgoing HTTP requests
can join the same trace. Do not attach credentials, request bodies, or ticket
data as span attributes.

Set `OTEL_TRACING_ENABLED=false` (or leave it unset) to disable tracing. The
SDK and instrumentations are then not loaded and no spans are exported.
