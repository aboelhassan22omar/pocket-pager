import SwiftUI

// The managers' sign-in. Accounts are made by Aurexis: no sign-up and no automatic «forgot
// password» here, only WhatsApp. Arabic first, right to left.

// MARK: - Building blocks

/// One question: the label, the field, and one short line on what to type.
struct Question<Field: View>: View {
    let label: String
    let hint: String
    var invalid = false
    @ViewBuilder var field: () -> Field

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.headline).foregroundStyle(Theme.text)
            field()
                .padding(.horizontal, 14)
                .frame(minHeight: 52)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(invalid ? Color.red.opacity(0.8) : Theme.muted.opacity(0.3), lineWidth: 1))
            if !hint.isEmpty {
                Text(hint).font(.footnote).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            }
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
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title).font(.headline)
            }
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

/// «كلّمنا على واتساب»: new accounts, forgotten passwords, the subscription.
struct WhatsAppButton: View {
    let url: URL?
    var body: some View {
        if let url {
            Link(destination: url) {
                Label("كلّمنا على واتساب", systemImage: "message.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .foregroundStyle(Theme.text)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}

// MARK: - Sign in

struct LoginView: View {
    @ObservedObject var account: AccountModel
    @State private var login = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 12) {
                    BrandTile(size: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: "Pocket Pager").font(.title2.bold()).foregroundStyle(Theme.text)
                        Text("تطبيق الإدارة").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
                .padding(.top, 24)

                Text("لأصحاب المطاعم ومديرين الفروع: تابع فروعك وطلباتها وتنبيهاتها من مكانك.")
                    .foregroundStyle(Theme.muted)

                Question(label: "رقم الموبايل أو اسم المستخدم", hint: "اللي وصلك من Aurexis.", invalid: error != nil && login.isEmpty) {
                    TextField("01012345678", text: $login)
                        .keyboardType(.asciiCapable)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .environment(\.layoutDirection, .leftToRight)
                }
                Question(label: "كلمة السر", hint: "", invalid: error != nil && password.isEmpty) {
                    SecureField("", text: $password).textContentType(.password)
                }
                ErrorLine(text: error)
                PrimaryButton(title: "دخول", busy: busy) { Task { await submit() } }

                VStack(spacing: 10) {
                    Text("لحساب جديد أو نسيت الباسورد كلّمنا على واتساب")
                        .font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                    WhatsAppButton(url: account.whatsappURL)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 8)

                Text("إنت عميل مستني طلبك؟ امسح الكود اللي عند الكاشير بكاميرا موبايلك، ورقمك هيظهر على طول.")
                    .font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            .padding(20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .task {
            await account.loadInfo()
            #if DEBUG
            // CI: `-ppLogin <phone> -ppPassword <password>` signs in by itself.
            if let l = UserDefaults.standard.string(forKey: "ppLogin"), let p = UserDefaults.standard.string(forKey: "ppPassword") {
                login = l
                password = p
                await submit()
            }
            #endif
        }
    }

    private func submit() async {
        error = nil
        guard !login.isEmpty else { error = "اكتب رقم موبايلك أو اسم المستخدم"; return }
        guard !password.isEmpty else { error = "اكتب كلمة السر"; return }
        busy = true
        defer { busy = false }
        do {
            let res = try await account.api.login(login.trimmingCharacters(in: .whitespaces), password: password)
            account.signedIn(brandId: res.brandId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
