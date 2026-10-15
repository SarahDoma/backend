# Scheduled jobs

Cron jobs are built on [`@nestjs/schedule`](https://docs.nestjs.com/techniques/task-scheduling)
and registered in `SchedulerModule` (`src/scheduler/`).

## Sample job

`HeartbeatJob` (`src/scheduler/heartbeat.job.ts`) runs every hour and logs
`Scheduler heartbeat`. It is both the template for real jobs and a liveness
signal: if the line stops appearing, no cron job is running.

```ts
@Injectable()
export class HeartbeatJob {
  @Cron(CronExpression.EVERY_HOUR, { name: HEARTBEAT_JOB_NAME })
  run(): void {
    this.logger.log('Scheduler heartbeat');
  }
}
```

## Adding a job

1. Write an `@Injectable()` class with a method decorated with `@Cron(...)`.
   Give it a `name` so it shows up in `SchedulerRegistry`.
2. Add the class to the `providers` in `SchedulerModule.forRoot()`.

Registering jobs there is what lets `SCHEDULER_ENABLED=false` switch them off.
Jobs run on **every** instance, so a job that must run once per cluster has to
make itself idempotent (see `docs/EVENT_REMINDERS.md` for the pattern used
there).

## Disabling

```bash
SCHEDULER_ENABLED=false
```

Cron jobs run unless this is exactly `false` (case-insensitive). With it off,
`SchedulerModule` registers nothing: no job class is instantiated and no timer
is created. Use it to keep cron work off web-only replicas or off a local
machine. Any other value is rejected at boot (`true` or `false` only).

The flag is read from the environment when the app module is built, not from
`ConfigService`, so `SchedulerModule.forRoot()` must stay after
`ConfigModule.forRoot()` in `AppModule` (that call is what loads `.env`).

It covers jobs registered through `SchedulerModule`. The pending-transaction
cleanup (`src/pending-tx/`) and event reminders (`src/events/`) run on their own
`setInterval` timers and are not affected.
