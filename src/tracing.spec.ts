import { startTracing, TracingShutdownService } from './tracing';

describe('optional tracing', () => {
  const original = process.env.OTEL_TRACING_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.OTEL_TRACING_ENABLED;
    else process.env.OTEL_TRACING_ENABLED = original;
  });

  it('does not initialize an SDK by default', async () => {
    delete process.env.OTEL_TRACING_ENABLED;
    expect(startTracing()).toBeUndefined();
    await expect(
      new TracingShutdownService().onApplicationShutdown(),
    ).resolves.toBeUndefined();
  });

  it('does not enable tracing for the string false', () => {
    process.env.OTEL_TRACING_ENABLED = 'false';
    expect(startTracing()).toBeUndefined();
  });
});
