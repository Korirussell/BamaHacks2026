import SwiftUI

@main
struct HandoffApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(store)
                .preferredColorScheme(store.theme.colorScheme)
                .tint(.hoAccent)
                .task { await store.bootstrap() }
        }
    }
}
