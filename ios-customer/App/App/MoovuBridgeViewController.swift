import Capacitor

class MoovuBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FcmTokenPlugin())
        NSLog("[MOOVU Push] FcmToken native bridge registered")
    }
}

