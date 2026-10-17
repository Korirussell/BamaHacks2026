import EventKit

/// features-v2 §1: add the handoff to the calendar. Demo-safe: callers show the success chip regardless.
enum CalendarService {
    static func add(title: String, placeName: String, startISO: String, minutes: Int = 15) {
        Task {
            let store = EKEventStore()
            do {
                guard try await store.requestWriteOnlyAccessToEvents() else {
                    print("[calendar] access denied — showing chip anyway")
                    return
                }
                let event = EKEvent(eventStore: store)
                event.title = title
                event.location = "\(placeName), University of Alabama, Tuscaloosa, AL"
                let start = ISO8601DateFormatter().date(from: startISO) ?? .now.addingTimeInterval(3600)
                event.startDate = start
                event.endDate = start.addingTimeInterval(TimeInterval(minutes * 60))
                event.addAlarm(EKAlarm(relativeOffset: -15 * 60))
                event.calendar = store.defaultCalendarForNewEvents
                try store.save(event, span: .thisEvent)
                print("[calendar] saved \(title)")
            } catch {
                print("[calendar] failed: \(error)")
            }
        }
    }
}
