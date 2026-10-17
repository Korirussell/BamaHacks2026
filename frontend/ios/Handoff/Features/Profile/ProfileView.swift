import SwiftUI

struct ProfileView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(spacing: 18) {
                if let me = store.meUser {
                    VStack(spacing: 10) {
                        Text(me.avatarEmoji).font(.system(size: 56))
                            .frame(width: 104, height: 104)
                            .background(Circle().fill(Color.hoMint))
                            .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                            .background(Circle().fill(Color.hoShadow).offset(x: 4, y: 4))
                        Text(me.displayName).font(.display(30)).displayTracking(30).foregroundStyle(Color.hoInk)
                        Text("\(me.major ?? "") · \(me.gradYear.map(String.init) ?? "")")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.hoSoft)
                        ReliabilityBadge(reliability: me.reliability)
                    }
                    .padding(.top, 12)

                    HStack(spacing: 12) {
                        stat("\(me.reliability.completed)", "trades")
                        stat(String(format: "%.1f★", me.reliability.score), "rating")
                        stat("\(me.reliability.noShows)", "no-shows")
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("THEME").font(.system(size: 11, weight: .heavy)).foregroundStyle(Color.hoSoft)
                    HStack(spacing: 0) {
                        ForEach(ThemeChoice.allCases) { t in
                            Button {
                                Haptics.tap()
                                store.theme = t
                            } label: {
                                Text(t.label)
                                    .font(.system(size: 13, weight: .heavy)).textCase(.uppercase)
                                    .foregroundStyle(store.theme == t ? Color.hoBg : Color.hoInk)
                                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                                    .background(Capsule().fill(store.theme == t ? Color.hoInk : Color.clear))
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .capsuleSticker()
                }

                VStack(spacing: 0) {
                    settingRow("envelope.fill", "Email", store.me?.email ?? "")
                    Rectangle().fill(Color.hoInk.opacity(0.15)).frame(height: 1)
                    settingRow("camera.fill", "Instagram", "not linked")
                    Rectangle().fill(Color.hoInk.opacity(0.15)).frame(height: 1)
                    settingRow("dollarsign.circle.fill", "Budget", Money.format(store.me?.budgetCents ?? 0))
                    Rectangle().fill(Color.hoInk.opacity(0.15)).frame(height: 1)
                    settingRow("building.columns.fill", "School", "University of Alabama")
                }
                .sticker(radius: 18, shadow: 3)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .background(Color.hoBg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.display(22)).foregroundStyle(Color.hoInk)
            Text(label).font(.system(size: 11, weight: .heavy)).textCase(.uppercase).foregroundStyle(Color.hoSoft)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .sticker(radius: 16, shadow: 3)
    }

    private func settingRow(_ icon: String, _ label: String, _ value: String) -> some View {
        HStack {
            Image(systemName: icon).frame(width: 24).foregroundStyle(Color.hoAccentText)
            Text(label).font(.system(size: 15, weight: .bold)).foregroundStyle(Color.hoInk)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.hoSoft)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
    }
}
