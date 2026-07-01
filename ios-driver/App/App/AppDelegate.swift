import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?
    private let cachedFcmTokenKey = "moovu.firebase.fcmToken"

    private func hexString(from data: Data) -> String {
        data.map { String(format: "%02.2hhx", $0) }.joined()
    }

    private func publishFcmToken(_ token: String, source: String) {
        guard !token.isEmpty else { return }
        UserDefaults.standard.set(token, forKey: cachedFcmTokenKey)
        NSLog("[MOOVU Push] FCM token ready from %@ (%lu chars)", source, token.count)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .moovuFcmTokenReady, object: token)
            NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
        }
    }

    private func publishFcmError(_ error: Error, source: String) {
        let message = error.localizedDescription
        NSLog("[MOOVU Push] FCM token failure from %@: %@", source, message)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .moovuFcmTokenError, object: message)
            NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NSLog("[MOOVU Push] Native FCM bridge build 2026-07-01")
        if FirebaseApp.app() == nil {
            NSLog("[MOOVU Push] FirebaseApp.configure called")
            FirebaseApp.configure()
            NSLog("[MOOVU Push] FirebaseApp.configure completed")
        } else {
            NSLog("[MOOVU Push] Firebase already configured")
        }
        Messaging.messaging().isAutoInitEnabled = true
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self
        NSLog("[MOOVU Push] Notification center delegate ready")
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NSLog("[MOOVU Push] didRegisterForRemoteNotificationsWithDeviceToken called")
        let apnsToken = hexString(from: deviceToken)
        NSLog("[MOOVU Push] APNs token received (%lu chars); never forwarding raw APNs token to JavaScript", apnsToken.count)
        Messaging.messaging().apnsToken = deviceToken
        NSLog("[MOOVU Push] Messaging.messaging().apnsToken assigned")
        NSLog("[MOOVU Push] Messaging.messaging().token callback requested")
        Messaging.messaging().token { token, error in
            if let error = error {
                self.publishFcmError(error, source: "token callback")
                return
            }
            guard let token = token, !token.isEmpty else {
                let error = NSError(
                    domain: "MOOVUPush",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Firebase returned an empty FCM token."]
                )
                self.publishFcmError(error, source: "token callback")
                return
            }
            NSLog("[MOOVU Push] Messaging.messaging().token callback succeeded (%lu chars)", token.count)
            self.publishFcmToken(token, source: "token callback")
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[MOOVU Push] APNs registration failed: %@", error.localizedDescription)
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken, !token.isEmpty else { return }
        NSLog("[MOOVU Push] Messaging delegate received refreshed FCM token (%lu chars)", token.count)
        publishFcmToken(token, source: "MessagingDelegate")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        NSLog("[MOOVU Push] Foreground notification received")
        completionHandler([.banner, .badge, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        NSLog("[MOOVU Push] Notification action received")
        completionHandler()
    }

}
