import { Module } from '@nestjs/common';
import { InegiModule } from './inegi/inegi.module';

/** Root application module. Only responsibility is wiring feature modules. */
@Module({
  imports: [InegiModule],
})
export class AppModule {}
