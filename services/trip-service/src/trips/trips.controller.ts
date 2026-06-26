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
import { TripsService } from './trips.service';
import { CreateTripDto, EndTripDto, RateTripDto, CancelTripDto } from './dto';

@Controller('trips')
@UseGuards(AuthGuard('jwt'), ThrottlerGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  createTrip(@Request() req: any, @Body() dto: CreateTripDto) {
    return this.trips.createTrip(req.user.sub, dto);
  }

  @Get(':id')
  getTrip(@Request() req: any, @Param('id') id: string) {
    return this.trips.getTripById(id, req.user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelTrip(@Request() req: any, @Param('id') id: string, @Body() dto: CancelTripDto) {
    return this.trips.cancelTrip(id, req.user.sub, dto.reason);
  }

  @Post(':id/accept')
  acceptTrip(@Request() req: any, @Param('id') id: string) {
    return this.trips.acceptTrip(id, req.user.sub);
  }

  @Post(':id/arrived')
  markArrived(@Request() req: any, @Param('id') id: string) {
    return this.trips.markArrived(id, req.user.sub);
  }

  @Post(':id/start')
  startTrip(@Request() req: any, @Param('id') id: string) {
    return this.trips.startTrip(id, req.user.sub);
  }

  @Post(':id/end')
  endTrip(@Request() req: any, @Param('id') id: string, @Body() dto: EndTripDto) {
    return this.trips.endTrip(id, req.user.sub, dto);
  }

  @Post(':id/rate')
  rateTrip(@Request() req: any, @Param('id') id: string, @Body() dto: RateTripDto) {
    return this.trips.rateDriver(id, req.user.sub, dto);
  }

  @Post(':id/no-show')
  markNoShow(@Request() req: any, @Param('id') id: string) {
    return this.trips.markNoShow(id, req.user.sub);
  }
}
