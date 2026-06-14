import type { Interceptor, StatusObject } from '@grpc/grpc-js';
import { InterceptingCall, ListenerBuilder, RequesterBuilder } from '@grpc/grpc-js';
import {
  defaultGrpcRetryOptions,
  isRetryableError,
  type BackoffOptions,
  type GrpcRetryOptions,
} from './grpc-retry-policy';

export { defaultGrpcRetryOptions, isRetryableError, type BackoffOptions, type GrpcRetryOptions };

/**
 * Returns a GRPC interceptor that will perform automatic retries for some types of failed calls
 *
 * @param retryOptions Options for the retry interceptor
 */
export function makeGrpcRetryInterceptor(retryOptions: GrpcRetryOptions): Interceptor {
  return (options, nextCall) => {
    let savedSendMessage: any;
    let savedReceiveMessage: any;
    let savedMessageNext: (message: any) => void;

    const requester = new RequesterBuilder()
      .withStart(function (metadata, _listener, next) {
        // First attempt
        let attempt = 1;

        const listener = new ListenerBuilder()
          .withOnReceiveMessage((message, next) => {
            savedReceiveMessage = message;
            savedMessageNext = next;
          })
          .withOnReceiveStatus((status, next) => {
            const retry = () => {
              attempt++;
              const call = nextCall(options);
              call.start(metadata, {
                onReceiveMessage(message) {
                  savedReceiveMessage = message;
                },
                onReceiveStatus,
              });
              call.sendMessage(savedSendMessage);
              call.halfClose();
            };

            const onReceiveStatus = (status: StatusObject) => {
              if (retryOptions.retryableDecider(attempt, status)) {
                setTimeout(retry, retryOptions.delayFunction(attempt, status));
              } else {
                savedMessageNext(savedReceiveMessage);
                // TODO: For reasons that are completely unclear to me, if you pass a handcrafted
                // status object here, node will magically just exit at the end of this line.
                // No warning, no nothing. Here be dragons.
                next(status);
              }
            };

            onReceiveStatus(status);
          })
          .build();
        next(metadata, listener);
      })
      .withSendMessage((message, next) => {
        savedSendMessage = message;
        next(message);
      })
      .build();
    return new InterceptingCall(nextCall(options), requester);
  };
}
