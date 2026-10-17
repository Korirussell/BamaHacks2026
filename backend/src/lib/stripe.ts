import Stripe from "stripe";
import { ApiError } from "./errors.js";

/** The slice of the Stripe SDK we call; tests pass fakes of this shape. */
export interface StripeLike {
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
    retrieve(id: string, params?: Stripe.PaymentIntentRetrieveParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
    cancel(id: string, params?: Stripe.PaymentIntentCancelParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
  };
  transfers: {
    create(params: Stripe.TransferCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Transfer>;
  };
  refunds: {
    create(params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Refund>;
  };
  webhooks: {
    constructEvent(payload: string, header: string, secret: string): Stripe.Event;
  };
}

let client: StripeLike | undefined;

/** Lazily created from STRIPE_SECRET_KEY; throws a 503 only when card payments are actually used without a key. */
export function stripeClient(): StripeLike {
  if (client) return client;
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new ApiError(503, "INTERNAL", "Card payments aren't configured");
  client = new Stripe(key) as unknown as StripeLike;
  return client;
}
