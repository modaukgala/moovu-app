import UIKit
import Capacitor

/// UIScene lifecycle (required when building with Xcode 27 / iOS 27 SDK; Capacitor 8.5+).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Main.storyboard (UISceneStoryboardFile) normally provides the window with
        // MoovuBridgeViewController; only build one in code if it didn't.
        if window == nil {
            let window = UIWindow(windowScene: windowScene)
            window.rootViewController = MoovuBridgeViewController()
            window.makeKeyAndVisible()
            self.window = window
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Was applicationDidBecomeActive: clear the app icon badge when MOOVU opens.
        (UIApplication.shared.delegate as? AppDelegate)?.clearApplicationBadge(UIApplication.shared)
    }
}
