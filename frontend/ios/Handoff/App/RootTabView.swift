import SwiftUI

struct RootTabView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        @Bindable var store = store
        ZStack(alignment: .bottom) {
            Group {
                switch store.selectedTab {
                case .feed: NavigationStack { FeedView() }
                case .explore: NavigationStack { ExploreView() }
                case .activity: NavigationStack { ActivityView() }
                case .profile: NavigationStack { ProfileView() }
                case .sell: NavigationStack { FeedView() }
                }
            }
            .safeAreaInset(edge: .bottom) { if store.tabBarHiders.isEmpty { Color.clear.frame(height: 64) } }

            if store.tabBarHiders.isEmpty {
                StickerTabBar().transition(.move(edge: .bottom))
            }
        }
        .background(Color.hoBg.ignoresSafeArea())
        .overlay(alignment: .top) { ToastView() }
        .sheet(isPresented: $store.showSell) { SellView() }
    }
}

struct StickerTabBar: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            item(.feed, "house.fill", "Feed")
            item(.explore, "magnifyingglass", "Explore")
            Button {
                Haptics.tap()
                store.showSell = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 26, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(width: 62, height: 62)
                    .background(Circle().fill(Color.hoAccent))
                    .overlay(Circle().strokeBorder(Color.hoInk, lineWidth: 2))
                    .background(Circle().fill(Color.hoShadow).offset(x: 3, y: 3))
            }
            .buttonStyle(PressableStyle())
            .offset(y: -18)
            .frame(maxWidth: .infinity)
            .accessibilityLabel("Sell")
            item(.activity, "arrow.left.arrow.right", "Activity")
            item(.profile, "person.fill", "Profile")
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .background(
            Color.hoCard
                .overlay(alignment: .top) { Rectangle().fill(Color.hoInk).frame(height: 2) }
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private func item(_ tab: AppStore.Tab, _ icon: String, _ label: String) -> some View {
        let active = store.selectedTab == tab
        return Button {
            store.selectedTab = tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 19, weight: .bold))
                Text(label).font(.system(size: 10, weight: .heavy)).textCase(.uppercase)
            }
            .foregroundStyle(active ? Color.hoInk : Color.hoSoft)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }
}

struct ToastView: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        if let text = store.toast {
            Text(text)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.hoInkOnLight)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .sticker(radius: 16, shadow: 3, fill: .hoButter)
                .padding(.horizontal, 20)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { store.toast = nil }
        }
    }
}

private struct HidesTabBar: ViewModifier {
    @Environment(AppStore.self) private var store
    @State private var id = UUID().uuidString
    func body(content: Content) -> some View {
        content
            .onAppear { withAnimation(.easeOut(duration: 0.2)) { _ = store.tabBarHiders.insert(id) } }
            .onDisappear { withAnimation(.easeOut(duration: 0.2)) { _ = store.tabBarHiders.remove(id) } }
    }
}

extension View {
    func hidesTabBar() -> some View { modifier(HidesTabBar()) }
}
