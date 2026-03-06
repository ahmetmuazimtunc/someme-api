import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(userId: string, pagination: PaginationDto) {
    const [notifications, total, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where: { userId },
        include: {
          actor: { select: { id: true, username: true, displayName: true, photoUrl: true } },
          caption: { select: { id: true, text: true } },
        },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.notification.count({ where: { userId } }),
      this.db.notification.count({ where: { userId, read: false } }),
    ]);

    return { data: notifications, total, unreadCount, page: pagination.page, limit: pagination.limit };
  }

  async markAsRead(notificationId: string, userId: string) {
    await this.db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
    return { read: true };
  }

  async markAllAsRead(userId: string) {
    const { count } = await this.db.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { updated: count };
  }

  async getUnreadCount(userId: string) {
    const count = await this.db.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }
}
