import school from '@/mocks/school.json';
import usersJson from '@/mocks/users.json';
import me from '@/mocks/me.json';
import listingsJson from '@/mocks/listings.json';
import bidsJson from '@/mocks/bids.json';
import claim from '@/mocks/claim.json';
import thread from '@/mocks/thread.json';
import order from '@/mocks/order.json';
import placesJson from '@/mocks/places.json';
import schedules from '@/mocks/schedules.json';
import meetupsJson from '@/mocks/meetups.json';
import notificationsJson from '@/mocks/notifications.json';
import extras from '@/mocks/extras.json';
import screenshotResult from '@/mocks/screenshot_result.json';
import addUsers from '@/mocks/v2/add_users.json';
import addPlaces from '@/mocks/v2/add_places.json';
import addListings from '@/mocks/v2/add_listings.json';
import addNotifications from '@/mocks/v2/add_notifications.json';
import photoResult from '@/mocks/v2/photo_result.json';
import buyRequest from '@/mocks/v2/buy_request.json';
import meetupsMayaJson from '@/mocks/v2/meetups_maya.json';
import meetupsZoeJson from '@/mocks/v2/meetups_zoe.json';
import locker from '@/mocks/v2/locker.json';
import wishlist from '@/mocks/v2/wishlist.json';
import threadZoe from '@/mocks/v2/thread_zoe.json';
import history from '@/mocks/v2/history.json';
import type { Bid, Listing, MeetupSuggestion, Notification, Place, UserPublic } from './types';

// Web-only mock addition: the ghost bike's seller once claimed (not in the shared §5 data).
const jackson: UserPublic = {
  id: 'u_jackson', display_name: 'Jackson B.', avatar_emoji: '🧔🏻', major: 'Kinesiology', grad_year: 2027, school_id: 's_ua',
  reliability: { score: 0, completed: 0, no_shows: 0, badge: 'new' }, mutual_friend_count: 2,
};

export const users = [...(usersJson as UserPublic[]), ...(addUsers as UserPublic[]), jackson];
export const userById = (id?: string | null) => users.find(u => u.id === id);
export const listings = [...(listingsJson as Listing[]), ...(addListings as Listing[])];
export const bids = bidsJson as Bid[];
export const places = [...(placesJson as Place[]), ...(addPlaces as Place[])];
export const placeById = (id: string) => places.find(p => p.id === id)!;
export const meetups = meetupsJson as MeetupSuggestion[];
export const notifications = [...(addNotifications as Notification[]), ...(notificationsJson as Notification[])];
export const meetupsMaya = meetupsMayaJson as MeetupSuggestion[];
export const meetupsZoe = meetupsZoeJson as MeetupSuggestion[];
export { photoResult, buyRequest, locker, wishlist, threadZoe, history };
export { school, me, claim, thread, order, schedules, extras, screenshotResult };
