import SwiftUI
import PhotosUI

/// Sell (§11.8): pick a photo/screenshot → fake 3-step AI job (§13) → prefilled form → post to feed.
struct SellView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    enum Stage: Equatable { case pick, job, failed, form }
    enum Mode { case photo, screenshot }
    @State private var stage: Stage = .pick
    @State private var mode: Mode = .screenshot
    @State private var showCamera = false
    @State private var photo: PhotoResult?
    @State private var fast = true
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

    // JEV listing check (POST /ai/listing-review), run before anything is published.
    @State private var review: ListingReview?
    @State private var reviewedKey: String?
    @State private var reviewing = false
    @State private var reviewNote: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch stage {
                    case .pick: pickView
                    case .job: jobView
                    case .failed: failedView
                    case .form: if mode == .photo { photoFormView } else { formView }
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
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { data in
                showCamera = false
                guard let data else { return }
                imageData = data
                runJob()
            }
            .ignoresSafeArea()
        }
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
            option("📸", Copy.sellSnap, Copy.sellSnapSub, fill: .hoButter, hero: true) {
                forceFail = false; mode = .photo
                if UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true } else { showPicker = true }
            }
            option("🖼️", "Screenshot → listing", "Already posted it on Instagram? Drop the screenshot.", fill: .hoCard) {
                forceFail = false; mode = .screenshot; showPicker = true
            }
            .simultaneousGesture(LongPressGesture(minimumDuration: 0.8).onEnded { _ in
                // Hidden demo hook: long-press shows the failure state (§13).
                forceFail = true; mode = .screenshot; showPicker = true
            })
            option("📚", "Scan textbook", "Cover or ISBN → edition + your classes", fill: .hoCard) {
                forceFail = false; mode = .screenshot; showPicker = true
            }
            Button {
                // Simulator / no-photo fallback for the demo.
                forceFail = false; mode = .photo; imageData = nil; runJob()
            } label: {
                Text("No photo handy? Use the sample mouse 🖱️")
                    .font(.system(size: 13, weight: .heavy)).foregroundStyle(Color.hoAccentText)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
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
                Color.tile(mode == .photo ? "mint" : "peach")
                    .overlay(Text(mode == .photo ? "🖱️" : "🖼️").font(.system(size: w * 0.4)))
            }
        }
        .frame(width: w, height: h)
        .clipped()
        .sticker(radius: 16, shadow: 3)
    }

    private var jobView: some View {
        VStack(alignment: .leading, spacing: 18) {
            thumb
            .overlay { if mode == .photo && step < 4 { ScanLine() } }
            ForEach(steps.indices, id: \.self) { i in
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
                    Text(steps[i])
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
            for i in 1...steps.count {
                try? await Task.sleep(for: .milliseconds(mode == .photo ? 600 : 800))
                withAnimation(.snappy) { step = i }
                Haptics.soft()
            }
            if forceFail { withAnimation { stage = .failed }; return }
            if mode == .photo {
                photo = try? await store.api.fixture("photo_result")
                fast = true
            } else if let r = try? await store.api.screenshotJob() {
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

    private var steps: [String] { mode == .photo ? Copy.jobPhoto : Copy.jobSteps }

    // MARK: photo form (features-v2 Flow A — everything prefilled, 3rd click is Post)

    @ViewBuilder private var photoFormView: some View {
        if let r = photo {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    thumb(110, 130)
                        .overlay(alignment: .bottom) {
                            Text("\(r.detected.label) · \(Int(r.detected.confidence * 100))%")
                                .font(.system(size: 9.5, weight: .heavy)).foregroundStyle(.white)
                                .lineLimit(1).minimumScaleFactor(0.7)
                                .padding(.horizontal, 6).padding(.vertical, 3)
                                .background(Capsule().fill(Color.hoAccent))
                                .padding(6)
                        }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("We wrote your listing ✨").font(.display(20)).foregroundStyle(Color.hoInk)
                        confidence(r.confidence)
                        FlowChips(items: r.attributes)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(r.title).font(.display(22)).foregroundStyle(Color.hoInk)
                    HStack(spacing: 6) {
                        TagPill(text: r.category.capitalized)
                        TagPill(text: r.condition.replacingOccurrences(of: "_", with: " ").capitalized)
                        ForEach(r.tags.prefix(2), id: \.self) { TagPill(text: "#\($0)") }
                    }
                    Text(r.description).font(.system(size: 14)).foregroundStyle(Color.hoInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .sticker(radius: 18, shadow: 3)

                Text("PRICE").font(.system(size: 11, weight: .heavy)).foregroundStyle(Color.hoSoft)
                HStack(spacing: 12) {
                    priceOption(Copy.sellPriceFast, on: fast) { fast = true }
                    priceOption(Copy.sellPriceMax, on: !fast) { fast = false }
                }

                Text(r.modelNote).font(.system(size: 11.5, weight: .bold)).foregroundStyle(Color.hoSoft)

                let key = "photo|\(r.title)|\(fast)"
                reviewCard(for: key)

                Button(postLabel(Copy.sellPost, key: key)) {
                    checkThenPublish(key: key, title: r.title, description: r.description, category: r.category,
                                     priceCents: fast ? r.priceModel.fastCents : r.priceModel.maxCents) { postPhoto(r) }
                }
                .buttonStyle(.pill(.primary, full: true))
                .disabled(postBlocked(key))
            }
        }
    }

    private func priceOption(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        let parts = label.components(separatedBy: " · ")
        return Button {
            Haptics.tap(); withAnimation(.snappy) { action() }
        } label: {
            VStack(spacing: 2) {
                Text(parts.first ?? "").font(.system(size: 11, weight: .heavy)).textCase(.uppercase)
                Text(parts.count > 1 ? parts[1] : "").font(.display(26))
                Text(parts.count > 2 ? parts[2] : "").font(.system(size: 11.5, weight: .bold)).opacity(0.7)
            }
            .foregroundStyle(on ? Color.hoInkOnLight : Color.hoInk)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .sticker(radius: 18, shadow: on ? 4 : 2, fill: on ? .hoButter : .hoCard)
        }
        .buttonStyle(PressableStyle())
    }

    private func postPhoto(_ r: PhotoResult) {
        let listing = Listing(
            id: "l_mouse", title: r.title, description: r.description, category: r.category,
            priceCents: fast ? r.priceModel.fastCents : r.priceModel.maxCents, negotiable: true,
            condition: r.condition, emoji: r.emoji, tile: r.tile, tag: "New", locationLabel: "Bevill Building",
            status: "active", sellerId: store.me?.userId ?? "u_kori",
            source: .init(channel: "screenshot_local", authorHandle: nil, postCaption: nil, postUrl: nil, postedAgo: nil, claimed: true),
            fairPrice: .init(lowCents: r.priceModel.fastCents, highCents: r.priceModel.maxCents), interest: nil, reason: "new",
            createdAt: ISO8601DateFormatter().string(from: .now), localImageData: imageData)
        Haptics.success()
        dismiss()
        store.publish(listing)
        store.scheduleBuyRequest()
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
            if let line = result?.priceSourceLine {
                Label(line, systemImage: "sparkles")
                    .font(.system(size: 12.5, weight: .bold)).foregroundStyle(Color.hoAccentText)
                    .fixedSize(horizontal: false, vertical: true)
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

            let key = "form|\(title)|\(price)|\(descriptionText)"
            reviewCard(for: key)

            Button(postLabel("Post", key: key)) {
                checkThenPublish(key: key, title: title, description: descriptionText,
                                 category: result?.category ?? "other", priceCents: price) { post() }
            }
            .buttonStyle(.pill(.primary, full: true))
            .disabled(title.isEmpty || postBlocked(key))
        }
    }

    // MARK: listing check (JEV gate)

    /// The check that passed or failed belongs to the exact title/price/description it saw; editing re-runs it.
    private func current(_ key: String) -> ListingReview? { reviewedKey == key ? review : nil }

    private func postBlocked(_ key: String) -> Bool { reviewing || current(key)?.allowed == false }

    private func postLabel(_ base: String, key: String) -> String {
        if reviewing { return "Checking listing…" }
        guard let r = current(key) else { return base }
        if !r.allowed { return "Can't post this" }
        return r.warnings.isEmpty ? base : "Post anyway"
    }

    /// Runs POST /ai/listing-review, then publishes when it's clean. With warnings the user taps again
    /// ("Post anyway"); when it isn't allowed, publishing stays blocked until the listing changes.
    private func checkThenPublish(key: String, title: String, description: String, category: String,
                                  priceCents: Int, publish: @escaping () -> Void) {
        if let r = current(key) {
            if r.allowed { publish() }
            return
        }
        reviewing = true
        Task { @MainActor in
            let r: ListingReview
            do {
                r = try await AIAPI.listingReview(title: title, description: description, category: category, priceCents: priceCents)
                reviewNote = nil
            } catch {
                reviewNote = error.localizedDescription
                r = OfflineAI.listingReview(title: title, priceCents: priceCents)
            }
            reviewing = false
            withAnimation(.snappy) { review = r; reviewedKey = key }
            if r.allowed && r.warnings.isEmpty { publish() } else { Haptics.soft() }
        }
    }

    @ViewBuilder private func reviewCard(for key: String) -> some View {
        if reviewing {
            HStack(spacing: 10) {
                ProgressView().tint(Color.hoInk)
                Text("JEV is checking your listing…").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.hoSoft)
            }
        } else if let r = current(key), !r.allowed || !r.warnings.isEmpty {
            let blocked = !r.allowed
            let ink: Color = blocked ? .white : .hoInkOnLight
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(blocked ? "Can't post this" : "Heads up before you post",
                          systemImage: blocked ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 14, weight: .heavy))
                    Spacer()
                    Text(r.engine == "jev" ? "JEV-9B on-device" : "rules")
                        .font(.system(size: 10.5, weight: .heavy)).opacity(0.8)
                }
                ForEach(r.blockedReasons + r.warnings, id: \.self) { line in
                    HStack(alignment: .top, spacing: 6) {
                        Text("•")
                        Text(line).fixedSize(horizontal: false, vertical: true)
                    }
                    .font(.system(size: 13, weight: .semibold))
                }
                if let cat = r.suggestedCategory {
                    Text("Suggested category: \(cat.replacingOccurrences(of: "_", with: " ").capitalized)")
                        .font(.system(size: 12.5, weight: .bold))
                }
                if let reviewNote {
                    Text("Live check unavailable (\(reviewNote)). Basic checks only.")
                        .font(.system(size: 11.5, weight: .medium)).opacity(0.8)
                }
            }
            .foregroundStyle(ink)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .sticker(radius: 16, shadow: 3, fill: blocked ? .hoAccent : .hoButter)
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

private struct ScanLine: View {
    @State private var down = false
    var body: some View {
        GeometryReader { g in
            Rectangle().fill(Color.hoAccent).frame(height: 3)
                .shadow(color: .hoAccent, radius: 0, y: 2)
                .offset(y: down ? g.size.height - 3 : 0)
                .onAppear { withAnimation(.easeInOut(duration: 0.6).repeatForever()) { down = true } }
        }
        .allowsHitTesting(false)
    }
}

struct FlowChips: View {
    let items: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(items, id: \.self) { a in
                Text(a).font(.system(size: 11, weight: .heavy)).foregroundStyle(Color.hoInkOnLight)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(Color.hoMint))
                    .overlay(Capsule().strokeBorder(Color.hoInk, lineWidth: 1.5))
            }
        }
    }
}

/// Real camera on device ("Snap it"). The Simulator has no camera, so it uses PhotosPicker.
struct CameraPicker: UIViewControllerRepresentable {
    var onPick: (Data?) -> Void
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = .camera
        c.delegate = context.coordinator
        return c
    }
    func updateUIViewController(_ c: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onPick: (Data?) -> Void
        init(onPick: @escaping (Data?) -> Void) { self.onPick = onPick }
        func imagePickerController(_ p: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onPick((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.8))
        }
        func imagePickerControllerDidCancel(_ p: UIImagePickerController) { onPick(nil) }
    }
}
