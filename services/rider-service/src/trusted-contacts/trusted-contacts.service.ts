import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { IsString, IsPhoneNumber, Length } from 'class-validator';

export class AddTrustedContactDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsPhoneNumber('US')
  phone: string;

  @IsString()
  @Length(1, 50)
  relationship: string;
}

@Injectable()
export class TrustedContactsService {
  private prisma = new PrismaClient();

  async listContacts(userId: string) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider not found');

    return this.prisma.trustedContact.findMany({
      where: { riderId: rider.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addContact(userId: string, dto: AddTrustedContactDto) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider not found');

    const existingCount = await this.prisma.trustedContact.count({
      where: { riderId: rider.id },
    });
    if (existingCount >= 5) {
      throw new BadRequestException('Maximum of 5 trusted contacts allowed');
    }

    const contact = await this.prisma.trustedContact.create({
      data: {
        riderId: rider.id,
        name: dto.name,
        phone: dto.phone,
        relationship: dto.relationship,
      },
    });

    return contact;
  }

  async removeContact(userId: string, contactId: string) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider not found');

    const contact = await this.prisma.trustedContact.findUnique({ where: { id: contactId } });
    if (!contact || contact.riderId !== rider.id) {
      throw new NotFoundException('Contact not found');
    }

    await this.prisma.trustedContact.delete({ where: { id: contactId } });
    return { success: true };
  }
}
