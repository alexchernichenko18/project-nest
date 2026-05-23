import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'a1b2c3...' })
  @IsString()
  @MinLength(10)
  token: string;

  @ApiProperty({ minLength: 6, example: 'newSecret12' })
  @IsString()
  @MinLength(6)
  password: string;
}
