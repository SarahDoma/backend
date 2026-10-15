import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { HeartbeatJob } from './heartbeat.job';

describe('HeartbeatJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs a heartbeat each time it runs', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    new HeartbeatJob().run();
    new HeartbeatJob().run();

    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('Scheduler heartbeat');
  });
});
