import type { HelpTopic } from "../types";
import { addParticipantsTopic } from "./add-participants";
import { addStaffTopic } from "./add-staff";
import { adminOverviewTopic } from "./admin-overview";
import { adminVendorsTopic } from "./admin-vendors";
import { adminVenuesTopic } from "./admin-venues";
import { dayCentreHappyPathTopic } from "./day-centre-happy-path";
import { deferralAcrossOpsTopic } from "./deferral-across-ops";
import { eventDeliverHappyPathTopic } from "./event-deliver-happy-path";
import { eventOpenChecksTopic } from "./event-open-checks";
import { eventOvernightHotelTopic } from "./event-overnight-hotel";
import { eventsCreateConfirmOpenTopic } from "./events-create-confirm-open";
import { governanceHubIssueTopic } from "./governance-hub-issue";
import { hubThreeStreamsTopic } from "./hub-three-streams";
import { manifestActiveRunTopic } from "./manifest-active-run";
import { manifestStartRunTopic } from "./manifest-start-run";
import { mealsServiceTopic } from "./meals-service";
import { medicationRoundsTopic } from "./medication-rounds";
import { redVerbalConsultationTopic } from "./red-verbal-consultation";
import { rygePhilosophyTopic } from "./ryge-philosophy";
import { signInPinTopic } from "./sign-in-pin";

/** Alpha How-To catalogue (BL-105). Order = default list order. */
export const HELP_TOPICS: readonly HelpTopic[] = [
  signInPinTopic,
  rygePhilosophyTopic,
  hubThreeStreamsTopic,
  deferralAcrossOpsTopic,
  addStaffTopic,
  addParticipantsTopic,
  adminOverviewTopic,
  adminVenuesTopic,
  adminVendorsTopic,
  eventOvernightHotelTopic,
  eventsCreateConfirmOpenTopic,
  eventOpenChecksTopic,
  eventDeliverHappyPathTopic,
  dayCentreHappyPathTopic,
  mealsServiceTopic,
  medicationRoundsTopic,
  manifestStartRunTopic,
  manifestActiveRunTopic,
  redVerbalConsultationTopic,
  governanceHubIssueTopic,
];
