import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";
import { EventBus } from "../../core/events/services/EventBus.ts";
import { ApplicationContext } from "../../core/platform/services/ApplicationContext.ts";
import { EnvService } from "../../core/platform/services/EnvService.ts";
import { LanternOptionsService } from "../../core/platform/services/LanternOptionsService.ts";
import { UserConfigService } from "../../core/platform/services/UserConfigService.ts";

export const platformLayer = Layer.mergeAll(
  ApplicationContext.Live,
  UserConfigService.Live,
  EventBus.Live,
  EnvService.Live,
  LanternOptionsService.Live,
).pipe(
  Layer.provide(EnvService.Live),
  Layer.provide(LanternOptionsService.Live),
  Layer.provide(NodeContext.layer),
);
