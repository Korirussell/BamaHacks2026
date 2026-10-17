import SwiftUI

struct NotificationsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if store.notifications.isEmpty {
                    EmptyState(text: "You're all caught up.")
                }
                ForEach(store.notifications) { n in
                    HStack(alignment: .top, spacing: 12) {
                        Circle().fill(n.read ? Color.clear : Color.hoAccent)
                            .frame(width: 10, height: 10).padding(.top, 6)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(n.title).font(.system(size: 15, weight: .heavy)).foregroundStyle(Color.hoInk)
                            Text(n.body).font(.system(size: 13, weight: .medium)).foregroundStyle(Color.hoSoft)
                        }
                        Spacer()
                        Text(n.ago).font(.system(size: 12, weight: .bold)).foregroundStyle(Color.hoSoft)
                    }
                    .padding(14)
                    .sticker(radius: 18, shadow: 3, fill: n.read ? .hoCard : .hoSunk)
                }
            }
            .padding(16)
        }
        .background(Color.hoBg.ignoresSafeArea())
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color.hoBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        .hidesTabBar()
        .onDisappear { store.markNotificationsRead() }
    }
}
