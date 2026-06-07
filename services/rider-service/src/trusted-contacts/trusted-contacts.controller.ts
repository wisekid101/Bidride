import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { TrustedContactsService, AddTrustedContactDto } from './trusted-contacts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('riders/me/trusted-contacts')
export class TrustedContactsController {
  constructor(private readonly trustedContactsService: TrustedContactsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  listContacts(@Headers('x-user-id') userId: string) {
    return this.trustedContactsService.listContacts(userId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  addContact(
    @Headers('x-user-id') userId: string,
    @Body() dto: AddTrustedContactDto,
  ) {
    return this.trustedContactsService.addContact(userId, dto);
  }

  @Delete(':contactId')
  @UseGuards(JwtAuthGuard)
  removeContact(
    @Headers('x-user-id') userId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.trustedContactsService.removeContact(userId, contactId);
  }
}
