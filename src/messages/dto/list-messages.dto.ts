import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListMessagesDto {
  @ApiPropertyOptional({ description: 'ID of the last message from previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Substring to search in message text (case-insensitive)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
  )
  @MaxLength(200)
  search?: string;
}
