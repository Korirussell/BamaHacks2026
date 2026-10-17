import SwiftUI
import PhotosUI

/// Sell (§11.8): pick a photo/screenshot → fake 3-step AI job (§13) → prefilled form → post to feed.
struct SellView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    enum Stage: Equatable { case pick, job, failed, form }
    @State private var stage: Stage = .pick
    @State private var pickerItem: PhotosPickerItem?
    @State private var showPicker = false
    @State private var imageData: Data?
    @State private var step = 0
    @State private var forceFail = false

    @State private var result: ScreenshotResult?
    @State private var title = ""
    @State private var price = 2500
    @State private var condition = ""
    @State private var descriptionText = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch stage {
                    case .pick: pickView
                    case .job: jobView
                    case .failed: failedView
                    case .form: formView
                    }
                }
                .padding(20)
            }
            .background(Color.hoBg.ignoresSafeArea())
            .navigationTitle("Sell")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark").fontWeight(.heavy) }.tint(Color.hoInk)
                }
            }
        }
        .photosPicker(isPresented: $showPicker, selection: $pickerItem, matching: .images)
        .onChange(of: pickerItem) {
            guard let pickerItem else { return }
            imageData = nil
            runJob()
            Task { imageData = try? await pickerItem.loadTransferable(type: Data.self) }
        }
    }

    // MARK: pick

    private var pickView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What are you selling?").font(.display(28)).displayTracking(28).foregroundStyle(Color.hoInk)
            option("📸", "Photos", "Snap it, we'll do the rest", fill: .hoCard) { forceFail = false; showPicker = true }
            option("🖼️", "Screenshot → listing", "Already posted it on Instagram? Drop the screenshot.", fill: .hoButter, hero: true) {
                forceFail = false; showPicker = true
            }
            .simultaneousGesture(LongPressGesture(minimumDuration: 0.8).onEnded { _ in
                // Hidden demo hook: long-press shows the failure state (§13).
                forceFail = true; showPicker = true
            })
            option("📚", "Scan textbook", "Cover or ISBN → edition + your classes", fill: .hoCard) { forceFail = false; showPicker = true }
        }
    }

    private func option(_ emoji: String, _ title: String, _ sub: String, fill: Color, hero: Bool = false,
                        action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Text(emoji).font(.system(size: hero ? 40 : 32))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.display(hero ? 21 : 18))
                    Text(sub).font(.system(size: 13, weight: .medium)).opacity(0.75)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "arrow.right").font(.system(size: 16, weight: .heavy))
            }
            .foregroundStyle(fill == .hoButter ? Color.hoInkOnLight : Color.hoInk)
            .padding(hero ? 20 : 16)
            .sticker(radius: 20, shadow: hero ? 5 : 3, fill: fill)
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: job

    private var thumb: some View { thumb(110, 140) }

    private func thumb(_ w: CGFloat, _ h: CGFloat) -> some View {
        Group {
            if let imageData, let img = UIImage(data: imageData) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Color.hoPeach.overlay(Text("🖼️").font(.system(size: 40)))
            }
        }
        .frame(width: w, height: h)
        .clipped()
        .sticker(radius: 16, shadow: 3)
    }

    private var jobView: some View {
        VStack(alignment: .leading, spacing: 18) {
            thumb
            ForEach(Copy.jobSteps.indices, id: \.self) { i in
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(i < step ? Color.hoMint : (i == step ? Color.hoButter : Color.hoCard))
                        Circle().strokeBorder(Color.hoInk, lineWidth: 2)
                        if i < step {
                            Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                        } else if i == step {
                            ProgressView().scaleEffect(0.6).tint(Color.hoInkOnLight)
                        }
                    }
                    .frame(width: 28, height: 28)
                    Text(Copy.jobSteps[i])
                        .font(.system(size: 16, weight: i == step ? .heavy : .semibold))
                        .foregroundStyle(i <= step ? Color.hoInk : Color.hoSoft)
                }
            }
        }
    }

    private var failedView: some View {
        VStack(alignment: .leading, spacing: 16) {
            thumb
            Text(Copy.jobFailed).font(.display(22)).foregroundStyle(Color.hoInk)
            HStack {
                Button("Retry") { forceFail = false; runJob() }.buttonStyle(.pill(.primary, small: true))
                Button("Fill it in") {
                    title = ""; descriptionText = ""; condition = ""; price = 2000
                    withAnimation { stage = .form }
                }
                .buttonStyle(.pill(.neutral, small: true))
            }
        }
    }

    private func runJob() {
        withAnimation { stage = .job; step = 0 }
        Task { @MainActor in
            for i in 1...3 {
                try? await Task.sleep(for: .milliseconds(800))
                withAnimation(.snappy) { step = i }
                Haptics.soft()
            }
            if forceFail { withAnimation { stage = .failed }; return }
            if let r = try? await store.api.screenshotJob() {
                result = r
                title = r.title
                price = r.priceCents
                condition = ""   // listed in missing_fields → user confirms it
                descriptionText = r.description
            }
            Haptics.success()
            withAnimation(.spring) { stage = .form }
        }
    }

    // MARK: form

    private var formView: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                thumb(90, 110)
                VStack(alignment: .leading, spacing: 6) {
                    Text("We wrote your listing ✨").font(.display(20)).foregroundStyle(Color.hoInk)
                    if let r = result {
                        Text("From \(r.authorHandle ?? "your screenshot")").font(.system(size: 12.5, weight: .bold)).foregroundStyle(Color.hoSoft)
                        confidence(r.confidence)
                    }
                }
            }

            field("Title") {
                TextField("Title", text: $title).font(.system(size: 16, weight: .semibold))
            }

            field("Price") {
                HStack {
                    Button { price = max(100, price - 100) } label: { Image(systemName: "minus") }
                    Spacer()
                    Text(Money.format(price)).font(.display(22)).monospacedDigit()
                    Spacer()
                    Button { price += 100 } label: { Image(systemName: "plus") }
                }
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(Color.hoInk)
                .buttonStyle(.plain)
            }
            if let fair = result?.fairPrice {
                Text("Fair price \(Money.format(fair.lowCents))–\(Money.format(fair.highCents))")
                    .font(.system(size: 12.5, weight: .bold)).foregroundStyle(Color.hoSoft)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("CONDITION").font(.system(size: 11, weight: .heavy)).foregroundStyle(Color.hoSoft)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(["new", "like_new", "good", "fair"], id: \.self) { c in
                            Button { condition = c } label: {
                                Text(c.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.system(size: 13, weight: .heavy))
                                    .foregroundStyle(condition == c ? Color.hoBg : Color.hoInk)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .background(Capsule().fill(condition == c ? Color.hoInk : Color.hoCard))
                                    .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 2))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(3)
                }
                .padding(6)
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(condition.isEmpty ? Color.hoButter : Color.clear, lineWidth: 3))
                if condition.isEmpty {
                    Text("We couldn't tell the condition. Pick one.").font(.system(size: 12, weight: .bold)).foregroundStyle(Color.hoAccentText)
                }
            }

            field("Description") {
                TextField("Description", text: $descriptionText, axis: .vertical)
                    .lineLimit(2...5).font(.system(size: 15))
            }

            Button("Post") { post() }
                .buttonStyle(.pill(.primary, full: true))
                .disabled(title.isEmpty)
        }
    }

    private func confidence(_ c: Double) -> some View {
        HStack(spacing: 8) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.hoSunk)
                    Capsule().fill(Color.hoMint).frame(width: g.size.width * c)
                }
                .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 1.5))
            }
            .frame(width: 90, height: 10)
            Text("\(Int(c * 100))% sure").font(.system(size: 12, weight: .heavy)).foregroundStyle(Color.hoInk)
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.system(size: 11, weight: .heavy)).foregroundStyle(Color.hoSoft)
            content()
                .foregroundStyle(Color.hoInk)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .sticker(radius: 16, shadow: 3)
        }
    }

    private func post() {
        let iso = ISO8601DateFormatter().string(from: .now)
        let listing = Listing(
            id: "l_\(UUID().uuidString.prefix(6))", title: title, description: descriptionText,
            category: result?.category ?? "other", priceCents: price, negotiable: true,
            condition: condition.isEmpty ? "good" : condition, emoji: "🛋️", tile: "peach", tag: "New",
            locationLabel: nil, status: "active", sellerId: store.me?.userId ?? "u_kori",
            source: .init(channel: "screenshot_local", authorHandle: nil, postCaption: nil, postUrl: nil, postedAgo: nil, claimed: true),
            fairPrice: result?.fairPrice, interest: nil, reason: "new", createdAt: iso, localImageData: imageData)
        Haptics.success()
        dismiss()
        store.publish(listing)
    }
}
