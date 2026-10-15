/* eslint-disable @typescript-eslint/no-require-imports -- synchronous SDK registration must precede Nest imports */
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { OnApplicationShutdown } from '@nestjs/common';

let activeSdk: NodeSDK | undefined;

export class TracingShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await activeSdk?.shutdown();
    activeSdk = undefined;
  }
}

/** Enable tracing only with an explicit opt-in; SDK imports stay out of the default path. */
export function startTracing(): NodeSDK | undefined {
  if (process.env.OTEL_TRACING_ENABLED !== 'true') return undefined;

  // The SDK and instrumentations must be required before Nest/Express imports.
  const { NodeSDK } =
    require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } =
    require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } =
    require('@opentelemetry/instrumentation-http') as typeof import('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } =
    require('@opentelemetry/instrumentation-express') as typeof import('@opentelemetry/instrumentation-express');
  const { NestInstrumentation } =
    require('@opentelemetry/instrumentation-nestjs-core') as typeof import('@opentelemetry/instrumentation-nestjs-core');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'stellar-tickets-backend',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
    ],
  });
  sdk.start();
  activeSdk = sdk;
  return sdk;
}
