import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { SchedulerService } from './scheduler.service';

// Internal-only: manual triggers share the exact scheduled implementations;
// status exposes this replica's last observed result per job.

@UseGuards(InternalKeyGuard)
@Controller('ai/scheduler')
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get('status')
  async status() {
    return {
      instanceId: this.scheduler.instanceId,
      jobs: await this.scheduler.loadJobs(),
      lastResults: Object.fromEntries(this.scheduler.lastResults),
    };
  }

  @Post('tick')
  @HttpCode(HttpStatus.OK)
  tick() {
    return this.scheduler.tick();
  }

  @Post('run/:job')
  @HttpCode(HttpStatus.OK)
  run(@Param('job') job: string) {
    return this.scheduler.runNow(job);
  }
}
