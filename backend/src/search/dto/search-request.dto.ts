import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  ownerName!: string;

  // Optional for now — address-based matching/scoring is added once the
  // Google Places autocomplete integration and matching engine are wired up.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}
