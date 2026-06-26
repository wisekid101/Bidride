import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { BidsService } from './bids.service';
import { SubmitBidDto, CounterBidDto } from './bids.dto';

@Controller('bids')
@UseGuards(AuthGuard('jwt'), ThrottlerGuard)
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  /** Rider submits a bid — creates trip + bid atomically */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  submitBid(@Request() req: any, @Body() dto: SubmitBidDto) {
    return this.bids.submitBid(req.user.sub, dto);
  }

  /** Rider or driver fetches bid status */
  @Get(':id')
  getBid(@Request() req: any, @Param('id') id: string) {
    return this.bids.getBid(id, req.user.sub);
  }

  /** Driver accepts a pending bid */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  acceptBid(@Request() req: any, @Param('id') id: string) {
    return this.bids.driverAcceptBid(id, req.user.sub);
  }

  /** Driver declines a pending bid */
  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  declineBid(@Request() req: any, @Param('id') id: string) {
    return this.bids.driverDeclineBid(id, req.user.sub);
  }

  /** Driver counters a pending bid */
  @Post(':id/counter')
  @HttpCode(HttpStatus.OK)
  counterBid(@Request() req: any, @Param('id') id: string, @Body() dto: CounterBidDto) {
    return this.bids.driverCounterBid(id, req.user.sub, dto);
  }

  /** Rider accepts a driver's counter offer */
  @Post(':id/counter/accept')
  @HttpCode(HttpStatus.OK)
  acceptCounter(@Request() req: any, @Param('id') id: string) {
    return this.bids.riderAcceptCounter(id, req.user.sub);
  }

  /** Rider declines a driver's counter offer */
  @Post(':id/counter/decline')
  @HttpCode(HttpStatus.OK)
  declineCounter(@Request() req: any, @Param('id') id: string) {
    return this.bids.riderDeclineCounter(id, req.user.sub);
  }

  /** Rider withdraws a pending bid (before driver responds) */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  withdrawBid(@Request() req: any, @Param('id') id: string) {
    return this.bids.withdrawBid(id, req.user.sub);
  }
}
