import { IsString, MinLength } from 'class-validator';

/** Body ของ `POST /firmware/{id}/simulate` — รุ่นอุปกรณ์ที่จะทดสอบด้วย */
export class SimulateFirmwareDto {
  @IsString()
  @MinLength(1)
  deviceModel!: string;
}
