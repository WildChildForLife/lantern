import { Context, Effect, Layer } from "effect";
import type { QuestionResponse } from "../../../../types/question.ts";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { AskUserQuestionService } from "../services/AskUserQuestionService.ts";

const LayerImpl = Effect.gen(function* () {
  const askUserQuestionService = yield* AskUserQuestionService;

  const questionResponse = (options: { questionResponse: QuestionResponse }) =>
    Effect.sync(() => {
      Effect.runFork(askUserQuestionService.respondToQuestion(options.questionResponse));

      return {
        status: 200,
        response: {
          message: "Question response received",
        },
      } as const satisfies ControllerResponse;
    });

  const getPendingQuestionRequests = () =>
    Effect.gen(function* () {
      const questionRequests = yield* askUserQuestionService.getPendingQuestionRequests;

      return {
        status: 200,
        response: {
          questionRequests,
        },
      } as const satisfies ControllerResponse;
    });

  return {
    questionResponse,
    getPendingQuestionRequests,
  };
});

export type IAskUserQuestionController = InferEffect<typeof LayerImpl>;
export class AskUserQuestionController extends Context.Tag("AskUserQuestionController")<
  AskUserQuestionController,
  IAskUserQuestionController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
