package com.smartshop.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmartShopPdfPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
