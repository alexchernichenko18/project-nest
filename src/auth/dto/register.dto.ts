import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'alex@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 6, example: 'secret12' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ required: false, example: 'Alex' })
  @IsOptional()
  @IsString()
  name?: string;
}