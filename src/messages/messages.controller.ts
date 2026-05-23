import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Req() req: any, @Body() dto: CreateMessageDto) {
    return this.messages.create(req.user.userId, dto.text);
  }

  @Get()
  list(@Query() dto: ListMessagesDto) {
    return this.messages.list(dto.cursor, dto.limit, dto.search);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.messages.delete(req.user.userId, id);
  }
}
