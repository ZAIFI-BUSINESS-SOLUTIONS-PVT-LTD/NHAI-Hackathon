import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { HomeScreen } from './src/screens/HomeScreen';
import { EnrollmentScreen } from './src/screens/EnrollmentScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { AttendanceLogScreen } from './src/screens/AttendanceLogScreen';
import { initDatabase } from './src/storage/database';
import { startSyncEngine, stopSyncEngine } from './src/sync/syncEngine';

const Stack = createStackNavigator();

export default function App() {
  useEffect(() => {
    initDatabase()
      .then(() => startSyncEngine())
      .catch(err => console.error('[App] DB init failed:', err));
    return () => stopSyncEngine();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerStyle: { backgroundColor: '#0A0A0A' },
              headerTintColor: '#FFF',
              headerTitleStyle: { fontWeight: '700' },
              cardStyle: { backgroundColor: '#0A0A0A' },
            }}
          >
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Enroll"
              component={EnrollmentScreen}
              options={{ title: 'Enroll Worker', headerBackTitle: '' }}
            />
            <Stack.Screen
              name="Authenticate"
              component={AuthScreen}
              options={{ title: 'Authenticate', headerBackTitle: '' }}
            />
            <Stack.Screen
              name="AttendanceLogs"
              component={AttendanceLogScreen}
              options={{ title: 'Attendance Log', headerBackTitle: '' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
