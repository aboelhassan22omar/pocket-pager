import SwiftUI

// The managers' app once signed in: four native tabs. «الفروع» (every branch's day at a glance),
// «التنبيهات», «الإدارة» (the full dashboard of the website) and «حسابي». Everything refreshes
// live from the server's events and on every return to the app.

struct ManagerHome: View {
    @ObservedObject var account: AccountModel
    let brandId: String
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = ManagerHome.startTab

    var body: some View {
        TabView(selection: $tab) {
            BranchesTab(account: account)
                .tabItem { Label(account.overview?.owner.role == "manager" ? "فرعي" : "الفروع", systemImage: "storefront") }
                .tag(0)
            AlertsTab(account: account)
                .tabItem { Label("التنبيهات", systemImage: "bell") }
                .badge(account.alerts.filter { $0.at > lastSeenAlerts }.count)
                .tag(1)
            DashboardView(account: account, brandId: brandId)
                .tabItem { Label("الإدارة", systemImage: "slider.horizontal.3") }
                .tag(2)
            AccountTab(account: account)
                .tabItem { Label("حسابي", systemImage: "person.crop.circle") }
                .tag(3)
        }
        .tint(Theme.accent)
        .task {
            await account.refresh()
            account.startLive()
            account.askForNotifications()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await account.refresh() }
                account.startLive()
            } else if phase == .background {
                account.stopLive()
            }
        }
        .onChange(of: tab) { _, now in
            if now == 1 { lastSeenAlerts = Date().timeIntervalSince1970 * 1000 }
        }
    }

    @AppStorage("pp.business.alertsSeen") private var lastSeenAlerts: Double = 0

    /// CI screenshots: `-ppTab <0-3>` opens a tab (DEBUG builds only).
    static var startTab: Int {
        #if DEBUG
        return UserDefaults.standard.integer(forKey: "ppTab")
        #else
        return 0
        #endif
    }
}

// MARK: - Branches

struct BranchesTab: View {
    @ObservedObject var account: AccountModel
    @State private var path: [String] = BranchesTab.startPath

    /// CI screenshots: `-ppBranch <id>` opens that branch (DEBUG builds only).
    static var startPath: [String] {
        #if DEBUG
        if let id = UserDefaults.standard.string(forKey: "ppBranch") { return [id] }
        #endif
        return []
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let overview = account.overview {
                        if overview.branches.count > 1 { TotalsRow(branches: overview.branches) }
                        if let stopped = overview.stopped { StoppedNotice(reason: stopped, whatsapp: account.whatsappURL) }
                        ForEach(overview.branches) { branch in
                            NavigationLink(value: branch.id) { BranchCard(branch: branch) }
                                .buttonStyle(.plain)
                        }
                        if overview.branches.isEmpty {
                            Text("لسه مفيش فروع. كلّمنا على واتساب عشان نضيفها.").foregroundStyle(Theme.muted)
                        }
                    } else if let error = account.loadError {
                        ErrorLine(text: error)
                        SecondaryButton(title: "جرّب تاني", systemImage: "arrow.clockwise") { Task { await account.refresh() } }
                    } else {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                    }
                }
                .padding(16)
            }
            .refreshable { await account.refresh() }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(account.overview?.brand.name ?? "فروعي")
            .navigationDestination(for: String.self) { id in BranchDetail(account: account, branchId: id) }
        }
    }
}

struct TotalsRow: View {
    let branches: [BranchInfo]
    var body: some View {
        HStack(spacing: 10) {
            Stat(label: "طلبات النهارده", value: branches.reduce(0) { $0 + $1.ordersToday })
            Stat(label: "مفتوح دلوقتي", value: branches.reduce(0) { $0 + $1.openNow })
            Stat(label: "متأخر", value: branches.reduce(0) { $0 + $1.lateToday }, alert: true)
        }
    }
}

struct Stat: View {
    let label: String
    let value: Int
    var alert = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            Text("\(value)").font(.title2.bold().monospacedDigit())
                .foregroundStyle(alert && value > 0 ? Color(hex: 0xFF8A7A) : Theme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct StoppedNotice: View {
    let reason: String
    let whatsapp: URL?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(reason == "trial_ended" ? "التجربة المجانية خلصت" : reason == "unpaid" ? "الاشتراك خلص" : "الخدمة متوقفة")
                .font(.headline).foregroundStyle(Theme.text)
            Text("العملاء مش بياخدوا أرقام دلوقتي. كلّم مدير حسابك في Aurexis.").font(.subheadline).foregroundStyle(Theme.muted)
            WhatsAppButton(url: whatsapp)
        }
        .padding(14)
        .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct BranchCard: View {
    let branch: BranchInfo
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(branch.name).font(.headline).foregroundStyle(Theme.text)
                Spacer()
                Chip(text: branch.paused == true ? "مقفول مؤقتًا" : branch.planText,
                     color: branch.paused == true || branch.plan.status == "suspended" ? Color(hex: 0xFF8A7A) : Theme.accent)
            }
            HStack(spacing: 10) {
                MiniStat(label: "النهارده", value: branch.ordersToday)
                MiniStat(label: "مفتوح", value: branch.openNow)
                MiniStat(label: "متأخر", value: branch.lateToday, alert: true)
            }
            HStack(spacing: 6) {
                Circle().fill(branch.cashierOnline ? Theme.ready : Theme.muted.opacity(0.5)).frame(width: 8, height: 8)
                Text(branch.cashierOnline ? "شاشة الكاشير شغّالة" : "شاشة الكاشير مقفولة").font(.footnote).foregroundStyle(Theme.muted)
                Spacer()
                Image(systemName: "chevron.left").font(.footnote).foregroundStyle(Theme.muted)
            }
        }
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.muted.opacity(0.12)))
    }
}

struct Chip: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .overlay(Capsule().stroke(color.opacity(0.6)))
    }
}

struct MiniStat: View {
    let label: String
    let value: Int
    var alert = false
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(Theme.muted)
            Text("\(value)").font(.title3.bold().monospacedDigit())
                .foregroundStyle(alert && value > 0 ? Color(hex: 0xFF8A7A) : Theme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - One branch

struct BranchDetail: View {
    @ObservedObject var account: AccountModel
    let branchId: String
    @State private var sheet: URL?

    private var branch: BranchInfo? { account.overview?.branches.first { $0.id == branchId } }

    var body: some View {
        ScrollView {
            if let b = branch {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 10) {
                        Stat(label: "طلبات النهارده", value: b.ordersToday)
                        Stat(label: "مفتوح دلوقتي", value: b.openNow)
                        Stat(label: "متأخر", value: b.lateToday, alert: true)
                    }
                    InfoRow(title: "الاشتراك", value: b.planText)
                    InfoRow(title: "الفرع", value: b.paused == true ? "مقفول مؤقتًا: العملاء مش بياخدوا أرقام" : "بياخد طلبات")
                    InfoRow(title: "شاشة الكاشير", value: b.cashierOnline ? "شغّالة دلوقتي" : "مقفولة")
                    if let rating = b.avgRating7d { InfoRow(title: "تقييم العملاء (آخر 7 أيام)", value: String(format: "%.1f من 5", rating)) }
                    if let pin = b.pin { InfoRow(title: "الرقم السري للكاشير", value: pin, ltr: true) }

                    if let urls = b.urls {
                        Text("لينكات الفرع").font(.headline).foregroundStyle(Theme.text).padding(.top, 6)
                        LinkRow(title: "شاشة الكاشير", text: "على جهاز الكاشير، منها بيدوس «جاهز».", url: urls.bar) { sheet = $0 }
                        LinkRow(title: "شاشة الكود", text: "قدّام العميل، فيها الكود اللي بيمسحه.", url: urls.qr) { sheet = $0 }
                    }
                    Text("عشان تغيّر الخصائص أو الرسايل أو الكاشيرية افتح «الإدارة» تحت.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                .padding(16)
            } else {
                Text("الفرع ده مش موجود").foregroundStyle(Theme.muted).padding(40)
            }
        }
        .refreshable { await account.refresh() }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(branch?.name ?? "")
        .sheet(item: $sheet) { SafariSheet(url: $0).ignoresSafeArea() }
    }
}

struct InfoRow: View {
    let title: String
    let value: String
    var ltr = false
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(Theme.muted)
            Spacer(minLength: 12)
            Text(value).foregroundStyle(Theme.text).multilineTextAlignment(.trailing)
                .environment(\.layoutDirection, ltr ? .leftToRight : .rightToLeft)
        }
        .font(.subheadline)
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct LinkRow: View {
    let title: String
    let text: String
    let url: String
    let open: (URL) -> Void
    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                Text(text).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            if let link = URL(string: url) {
                ShareLink(item: link) { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("ابعت اللينك")
                Button { open(link) } label: { Image(systemName: "arrow.up.left.square") }
                    .accessibilityLabel("افتح")
            }
        }
        .font(.title3)
        .tint(Theme.accent)
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Alerts

struct AlertsTab: View {
    @ObservedObject var account: AccountModel
    private static let ago: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "ar-EG")
        return f
    }()

    var body: some View {
        NavigationStack {
            List {
                if account.alerts.isEmpty {
                    Text("مفيش تنبيهات. هنبعتلك هنا لو فرع وقف أو اتقفل، أو الاشتراك قرّب يخلص، أو شاشة الكاشير اتقفلت وقت الشغل.")
                        .foregroundStyle(Theme.muted)
                        .listRowBackground(Theme.surface)
                }
                ForEach(account.alerts) { alert in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(alert.title).font(.headline).foregroundStyle(Theme.text)
                        Text(alert.body).font(.subheadline).foregroundStyle(Theme.muted)
                        Text(Self.ago.localizedString(for: Date(timeIntervalSince1970: alert.at / 1000), relativeTo: Date()))
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Theme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .refreshable { await account.refresh() }
            .navigationTitle("التنبيهات")
        }
    }
}

// MARK: - Account

struct AccountTab: View {
    @ObservedObject var account: AccountModel
    @State private var confirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let o = account.overview?.owner {
                        InfoRow(title: "الاسم", value: o.name ?? o.username)
                        InfoRow(title: "بتدخل بـ", value: o.username, ltr: true)
                        InfoRow(title: "الصلاحية", value: o.role == "manager" ? "مدير فرع" : "صاحب المطعم")
                        if let brand = account.overview?.brand.name { InfoRow(title: "المطعم", value: brand) }
                    }
                    Text("لأي تغيير في الاشتراك أو الفروع أو الحساب كلّمنا على واتساب.")
                        .font(.subheadline).foregroundStyle(Theme.muted).padding(.top, 6)
                    WhatsAppButton(url: account.whatsappURL)
                    SecondaryButton(title: "خروج", systemImage: "rectangle.portrait.and.arrow.right") { confirm = true }
                        .padding(.top, 10)
                }
                .padding(16)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("حسابي")
            .confirmationDialog("تخرج من الحساب؟", isPresented: $confirm, titleVisibility: .visible) {
                Button("خروج", role: .destructive) { Task { await account.signOut() } }
                Button("رجوع", role: .cancel) {}
            }
        }
    }
}
