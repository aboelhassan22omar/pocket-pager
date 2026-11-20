import SwiftUI

// The restaurant side of the app. Every question says what it is, what to type and why, in one
// line under it, like the website (/signup). Arabic first, right to left.

// MARK: - Building blocks

/// One question: the label, the field, and one short line on what and why.
struct Question<Field: View>: View {
    let label: String
    let hint: String
    var optional = false
    var invalid = false
    @ViewBuilder var field: () -> Field

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(label).font(.headline).foregroundStyle(Theme.text)
                if optional { Text("(اختياري)").font(.subheadline).foregroundStyle(Theme.muted) }
            }
            field()
                .padding(.horizontal, 14)
                .frame(minHeight: 52)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(invalid ? Color.red.opacity(0.8) : Theme.muted.opacity(0.3), lineWidth: 1))
            Text(hint).font(.footnote).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct PrimaryButton: View {
    let title: String
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(Theme.onAccent) }
                Text(title).font(.headline)
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .foregroundStyle(Theme.onAccent)
            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
        }
        .disabled(busy)
    }
}

struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.headline)
                .frame(maxWidth: .infinity, minHeight: 52)
                .foregroundStyle(Theme.text)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 14))
        }
    }
}

struct ErrorLine: View {
    let text: String?
    var body: some View {
        if let text {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color(hex: 0xFFB4AA))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

struct BrandTile: View {
    var size: CGFloat = 72
    var body: some View {
        Image("BrandTile")
            .resizable()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            .accessibilityLabel("Pocket Pager")
    }
}

// MARK: - Welcome: what it is, in three pictures

struct WelcomeView: View {
    @ObservedObject var account: AccountModel
    @State private var page = 0

    private let pages: [(symbol: String, title: String, text: String)] = [
        ("qrcode.viewfinder", "عملاءك ياخدوا رقم من موبايلهم", "بيمسحوا الكود اللي عند الكاشير بالكاميرا، من غير ما ينزّلوا أي تطبيق."),
        ("hand.tap", "الكاشير يدوس «جاهز»", "من شاشة الكاشير على أي تابلت أو كمبيوتر أو موبايل جنبه."),
        ("bell.and.waves.left.and.right", "موبايل العميل يرن", "حتى والشاشة مقفولة. ييجي ياخد طلبه، ومفيش زحمة قدّام الكاونتر."),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                BrandTile(size: 36)
                Text(verbatim: "Pocket Pager").font(.title3.bold()).foregroundStyle(Theme.text)
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)

            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { i in
                    VStack(spacing: 18) {
                        ZStack {
                            Circle().fill(Theme.surface).frame(width: 150, height: 150)
                            Image(systemName: pages[i].symbol)
                                .font(.system(size: 62, weight: .regular))
                                .foregroundStyle(Theme.accent)
                        }
                        Text("\(i + 1) من 3").font(.footnote).foregroundStyle(Theme.muted)
                        Text(pages[i].title).font(.title2.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.center)
                        Text(pages[i].text).font(.body).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                            .padding(.horizontal, 28)
                    }
                    .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))

            VStack(spacing: 12) {
                PrimaryButton(title: "ابدأ ببلاش \(account.trialDays) أيام") { account.screen = .signup }
                SecondaryButton(title: "عندي حساب، دخول") { account.screen = .login }
                Text("إنت عميل مستني طلبك؟ امسح الكود اللي عند الكاشير بكاميرا موبايلك، ورقمك هيظهر على طول.")
                    .font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
            .frame(maxWidth: 480)
        }
        .task { await account.loadInfo() }
    }
}

// MARK: - Login

struct LoginView: View {
    @ObservedObject var account: AccountModel
    @State private var phone = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                BackBar { account.screen = .welcome }
                Text("أهلًا بيك تاني").font(.largeTitle.bold()).foregroundStyle(Theme.text)
                Text("لصاحب المطعم ومدير الفرع. الكاشير مش محتاج يدخل من هنا، هو بيفتح شاشة الكاشير بالرقم السري.")
                    .foregroundStyle(Theme.muted)

                Question(label: "رقم موبايلك", hint: "الرقم اللي عملت بيه الحساب.") {
                    TextField("01012345678", text: $phone)
                        .keyboardType(.phonePad).textContentType(.username)
                        .environment(\.layoutDirection, .leftToRight)
                }
                Question(label: "كلمة السر", hint: "لو نسيتها، كلّمنا ونرجّعها لك.") {
                    SecureField("", text: $password).textContentType(.password)
                }
                ErrorLine(text: error)
                PrimaryButton(title: "دخول", busy: busy) { Task { await submit() } }
                if let support = account.support, let url = URL(string: "https://wa.me/\(support.filter(\.isNumber))") {
                    Link("نسيت كلمة السر؟ كلّمنا على واتساب", destination: url)
                        .font(.subheadline).foregroundStyle(Theme.accent).frame(maxWidth: .infinity)
                }
                Button("أول مرة؟ اعمل حساب لمطعمك") { account.screen = .signup }
                    .font(.subheadline).foregroundStyle(Theme.accent).frame(maxWidth: .infinity)
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func submit() async {
        error = nil
        guard !phone.isEmpty else { error = "اكتب رقم موبايلك"; return }
        guard !password.isEmpty else { error = "اكتب كلمة السر"; return }
        busy = true
        defer { busy = false }
        do {
            let res = try await account.api.login(phone, password: password)
            account.signedIn(brandId: res.brandId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BackBar: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label("رجوع", systemImage: "chevron.right")
                .font(.subheadline).foregroundStyle(Theme.muted)
        }
    }
}

// MARK: - Sign up: you, your restaurant, its first branch

struct SignupView: View {
    @ObservedObject var account: AccountModel
    @State private var step = 1
    @State private var form = AccountAPI.SignupForm()
    @State private var slugTouched = false
    @State private var slugState: (ok: Bool, text: String)?
    @State private var error: String?
    @State private var field: String?
    @State private var busy = false
    @State private var checkTask: Task<Void, Never>?

    private let fieldStep = ["name": 1, "phone": 1, "password": 1, "brandName": 2, "brandId": 2, "branchName": 3, "branchSlug": 3]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                BackBar {
                    if step == 1 { account.screen = .welcome } else { step -= 1 }
                }
                StepsBar(step: step)
                switch step {
                case 1: stepOne
                case 2: stepTwo
                default: stepThree
                }
                ErrorLine(text: error)
                PrimaryButton(title: step == 3 ? "اعمل المطعم" : "كمّل", busy: busy) { Task { await next() } }
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
            .animation(.easeOut(duration: 0.25), value: step)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var stepOne: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("أهلًا بيك! خلّينا نعمل حسابك").font(.title.bold()).foregroundStyle(Theme.text)
            Text("3 خطوات صغيرة، وبعدها مطعمك يشتغل على طول. وأول \(account.trialDays) أيام ببلاش.").foregroundStyle(Theme.muted)
            Question(label: "اسمك", hint: "عشان نعرف نناديك بإسمك لما نكلمك.", invalid: field == "name") {
                TextField("مثلًا: أحمد علي", text: $form.name).textContentType(.name)
            }
            Question(label: "رقم موبايلك", hint: "هتدخل بيه كل مرة، مكان اسم المستخدم. مش هنبعتلك إعلانات.", invalid: field == "phone") {
                TextField("01012345678", text: $form.phone)
                    .keyboardType(.phonePad).textContentType(.telephoneNumber)
                    .environment(\.layoutDirection, .leftToRight)
            }
            Question(label: "كلمة سر", hint: "6 حروف أو أرقام على الأقل. دي ليك إنت بس، الكاشير مش محتاجها.", invalid: field == "password") {
                SecureField("", text: $form.password).textContentType(.newPassword)
            }
        }
    }

    private var stepTwo: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("مطعمك اسمه إيه؟").font(.title.bold()).foregroundStyle(Theme.text)
            Text("الاسم ده اللي عملاءك هيشوفوه على موبايلهم وهم مستنيين طلبهم.").foregroundStyle(Theme.muted)
            Question(label: "اسم المطعم أو الكافيه", hint: "اكتبه زي ما هو مكتوب على اليافطة، عربي أو إنجليزي.", invalid: field == "brandName") {
                TextField("مثلًا: كافيه زد", text: $form.brandName)
                    .onChange(of: form.brandName) { _, name in
                        if !slugTouched { form.brandId = Slug.suggest(name) }
                    }
            }
            Question(label: "اسم المطعم في اللينك",
                     hint: "كلمة قصيرة بالإنجليزي. العميل مش هيكتبها، هي جوه الكود اللي بيمسحه. عملناها لك من الاسم، وتقدر تغيّرها.",
                     invalid: field == "brandId") {
                HStack(spacing: 2) {
                    Text(verbatim: "\(account.host)/s/").font(.footnote).foregroundStyle(Theme.muted).lineLimit(1)
                    TextField("cafe-z", text: $form.brandId)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: form.brandId) { _, typed in
                            let clean = Slug.clean(typed)
                            if clean != typed { form.brandId = clean; return }
                            // Typed by hand (not our suggestion): stop following the name.
                            if typed != Slug.suggest(form.brandName) { slugTouched = true }
                            scheduleCheck()
                        }
                }
                .environment(\.layoutDirection, .leftToRight)
            }
            if let slugState {
                Text(slugState.text).font(.footnote).foregroundStyle(slugState.ok ? Theme.ready : Color(hex: 0xFF8A7A))
            }
            CustomerPreview(name: form.brandName, branch: form.branchName)
        }
    }

    private var stepThree: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("أول فرع فين؟").font(.title.bold()).foregroundStyle(Theme.text)
            Text("كل فرع ليه شاشة كاشير ولينك وكود لوحده. تقدر تزوّد فروع بعدين.").foregroundStyle(Theme.muted)
            Question(label: "اسم الفرع", hint: "اسم المنطقة غالبًا، زي «المعادي». لو عندك فرع واحد سيبها زي ما هي.", invalid: field == "branchName") {
                TextField("الفرع الرئيسي", text: $form.branchName)
            }
            Question(label: "اسم الفرع في اللينك", hint: "بيتحط آخر اللينك عشان كل فرع يبقى ليه لينك. سيبها فاضية لو عندك فرع واحد.",
                     optional: true, invalid: field == "branchSlug") {
                TextField("maadi", text: $form.branchSlug)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .environment(\.layoutDirection, .leftToRight)
                    .onChange(of: form.branchSlug) { _, typed in
                        let clean = Slug.clean(typed, max: 20)
                        if clean != typed { form.branchSlug = clean }
                    }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("لينك فرعك هيبقى:").font(.footnote).foregroundStyle(Theme.muted)
                Text(verbatim: "\(account.host)/s/\(form.branchSlug.isEmpty ? form.brandId : "\(form.brandId)-\(form.branchSlug)")")
                    .font(.callout.weight(.medium)).foregroundStyle(Color(hex: 0xFFB020))
                    .environment(\.layoutDirection, .leftToRight)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "gift").foregroundStyle(Theme.accent)
                Text("حسابك بيبدأ بتجربة \(account.trialDays) أيام، من غير أي بيانات دفع.")
                    .font(.subheadline).foregroundStyle(Theme.text)
            }
            .padding(14)
            .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func scheduleCheck() {
        checkTask?.cancel()
        let id = form.brandId
        guard Slug.isValid(id) else {
            slugState = id.isEmpty ? nil : (false, "من 3 حروف إنجليزي على الأقل")
            return
        }
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled, let res = try? await account.api.check(brandId: id), form.brandId == id else { return }
            slugState = res.brand.ok ? (true, "الاسم متاح") : (false, res.brand.error ?? "الاسم ده مستخدم")
        }
    }

    /// What's missing on this step, in the words next to the field.
    private func problem() -> (String, String)? {
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        switch step {
        case 1:
            if trim(form.name).count < 2 { return ("اكتب اسمك", "name") }
            if form.phone.filter(\.isNumber).count < 8 { return ("اكتب رقم موبايلك صح، زي 01012345678", "phone") }
            if form.password.count < 6 { return ("كلمة السر 6 حروف أو أرقام على الأقل", "password") }
        case 2:
            if trim(form.brandName).count < 2 { return ("اكتب اسم المطعم", "brandName") }
            if !Slug.isValid(form.brandId) { return ("اكتب اسم المطعم في اللينك بالإنجليزي (3 حروف على الأقل)", "brandId") }
            if slugState?.ok == false { return ("اسم اللينك ده مستخدم، جرّب اسم تاني", "brandId") }
        default:
            if !form.branchSlug.isEmpty, !Slug.isValid(form.branchSlug, min: 2) { return ("اسم الفرع في اللينك بالإنجليزي، أو سيبه فاضي", "branchSlug") }
        }
        return nil
    }

    private func next() async {
        error = nil
        field = nil
        if let missing = problem() {
            error = missing.0
            field = missing.1
            return
        }
        if step < 3 {
            step += 1
            return
        }
        busy = true
        defer { busy = false }
        do {
            let result = try await account.api.signup(form)
            UserDefaults.standard.set(result.brandId, forKey: "pp.business.brand")
            account.screen = .ready(result)
        } catch let failure as AccountAPI.Failure {
            if let f = failure.field, let s = fieldStep[f] { step = s }
            error = failure.message
            field = failure.field
        } catch {
            self.error = "حصلت مشكلة. جرّب تاني"
        }
    }
}

struct StepsBar: View {
    let step: Int
    private let names = ["حسابك", "مطعمك", "أول فرع"]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<3, id: \.self) { i in
                VStack(alignment: .leading, spacing: 8) {
                    Capsule().fill(i < step ? Theme.accent : Theme.surface2).frame(height: 3)
                    HStack(spacing: 6) {
                        Text("\(i + 1)").font(.caption.bold())
                            .frame(width: 22, height: 22)
                            .background(i < step ? Theme.accent : Theme.surface2, in: Circle())
                            .foregroundStyle(i < step ? Theme.onAccent : Theme.muted)
                        Text(names[i]).font(.footnote).foregroundStyle(i < step ? Theme.text : Theme.muted)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("خطوة \(step) من 3: \(names[step - 1])")
    }
}

/// What the customer will see, with the name being typed.
struct CustomerPreview: View {
    let name: String
    let branch: String

    var body: some View {
        HStack(spacing: 12) {
            Text(String((name.isEmpty ? "ك" : name).prefix(1)))
                .font(.headline.bold()).foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(LinearGradient(colors: [Color(hex: 0xFFA024), Theme.accent, Color(hex: 0xEE4510)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(name.isEmpty ? "كافيه زد" : name).font(.headline).foregroundStyle(Theme.text)
                Text("ده شكل اسمك عند العميل، فوق رقم طلبه").font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
        }
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.muted.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5])))
    }
}

// MARK: - Ready: the PIN and the first three steps

struct RestaurantReadyView: View {
    @ObservedObject var account: AccountModel
    let result: AccountAPI.SignupResult

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "checkmark").font(.title2.bold()).foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 6) {
                        Text("مطعمك جاهز!").font(.title.bold()).foregroundStyle(Theme.text)
                        Text(result.trial ? "عندك \(result.trialDays) أيام ببلاش. فاضل 3 حاجات بسيطة وتبدأ تشتغل."
                             : "الرقم ده جرّب قبل كده، فالفرع هيشتغل أول ما مدير حسابك في Aurexis يفعّله.")
                            .foregroundStyle(Theme.muted)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("الرقم السري لشاشة الكاشير").font(.headline).foregroundStyle(Theme.text)
                    Text(verbatim: result.pin).font(.system(size: 44, weight: .bold, design: .rounded))
                        .tracking(8).foregroundStyle(Color(hex: 0xFFB020))
                        .environment(\.layoutDirection, .leftToRight)
                    Text("الكاشير بيكتبه مرة واحدة بس على جهازه. احفظه، وتقدر تغيّره بعدين من «اللينكات والرقم السري».")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 14))

                StepRow(number: 1, title: "افتح شاشة الكاشير على جهاز الكاشير",
                        text: "تابلت أو كمبيوتر أو موبايل جنب الكاشير. ابعتله اللينك ده وافتحه عليه.") {
                    if let url = URL(string: result.urls.bar) {
                        HStack {
                            ShareLink(item: url) { Label("ابعت اللينك", systemImage: "square.and.arrow.up") }
                                .buttonStyle(.borderedProminent).tint(Theme.accent).foregroundStyle(Theme.onAccent)
                            Link("افتحه هنا", destination: url).buttonStyle(.bordered).tint(Theme.text)
                        }
                    }
                }
                StepRow(number: 2, title: "حط الكود قدّام العميل",
                        text: "افتح شاشة الكود على شاشة صغيرة قدّام العميل، أو اطبعه وحطه على الكاونتر.") {
                    if let url = URL(string: result.urls.qr) {
                        ShareLink(item: url) { Label("ابعت لينك شاشة الكود", systemImage: "qrcode") }
                            .buttonStyle(.bordered).tint(Theme.text)
                    }
                }
                StepRow(number: 3, title: "جرّب بنفسك",
                        text: "امسح الكود بكاميرا موبايلك، وبعدين دوس على الرقم في شاشة الكاشير. موبايلك هيرن.") { EmptyView() }

                SecondaryButton(title: "ادخل لوحة التحكم") { account.signedIn(brandId: result.brandId) }
            }
            .padding(20)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
    }
}

struct StepRow<Actions: View>: View {
    let number: Int
    let title: String
    let text: String
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)").font(.subheadline.bold()).foregroundStyle(Theme.text)
                .frame(width: 30, height: 30)
                .overlay(Circle().stroke(Theme.muted.opacity(0.4)))
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline).foregroundStyle(Theme.text)
                Text(text).font(.subheadline).foregroundStyle(Theme.muted)
                actions()
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
    }
}
