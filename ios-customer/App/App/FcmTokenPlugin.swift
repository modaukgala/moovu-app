import Foundation
import Capacitor
import FirebaseMessaging

extension Notification.Name {
    static let moovuFcmTokenReady = Notification.Name("moovuFcmTokenReady")
    static let moovuFcmTokenError = Notification.Name("moovuFcmTokenError")
}

@objc(FcmTokenPlugin)
public class FcmTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FcmTokenPlugin"
    public let jsName = "FcmToken"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise)
    ]

    private static let cachedTokenKey = "moovu.firebase.fcmToken"
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        observers.append(
            NotificationCenter.default.addObserver(
                forName: .moovuFcmTokenReady,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let token = notification.object as? String, !token.isEmpty else { return }
                self?.notifyListeners(
                    "fcmTokenReady",
                    data: ["token": token],
                    retainUntilConsumed: true
                )
            }
        )

        observers.append(
            NotificationCenter.default.addObserver(
                forName: .moovuFcmTokenError,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let message = notification.object as? String, !message.isEmpty else { return }
                self?.notifyListeners(
                    "fcmTokenError",
                    data: ["message": message],
                    retainUntilConsumed: true
                )
            }
        )
    }

    @objc func getToken(_ call: CAPPluginCall) {
        if let cachedToken = UserDefaults.standard.string(forKey: Self.cachedTokenKey),
           !cachedToken.isEmpty {
            call.resolve(["token": cachedToken])
            return
        }

        Messaging.messaging().token { token, error in
            DispatchQueue.main.async {
                if let error = error {
                    NSLog("[MOOVU Push] FcmToken.getToken failed: %@", error.localizedDescription)
                    call.reject(error.localizedDescription)
                    return
                }

                guard let token = token, !token.isEmpty else {
                    call.resolve(["token": NSNull()])
                    return
                }

                UserDefaults.standard.set(token, forKey: Self.cachedTokenKey)
                NSLog("[MOOVU Push] FcmToken.getToken succeeded (%lu chars)", token.count)
                call.resolve(["token": token])
            }
        }
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}

