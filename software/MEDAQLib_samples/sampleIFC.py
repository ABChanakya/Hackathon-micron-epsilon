
# This is a very simple sample following MEDAQLib.pdf section 4 Using MEDAQLib
#
# Please adjust to your setup (interface card and sensor used)
#
# IFC2411
# JKu 06.02.2026
# V0.02
#



from MEDAQLib import MEDAQLib, ME_SENSOR, ERR_CODE
import time
import sys

# Tell MEDAQLib about sensor type to be used
#MEDAQLib_object = MEDAQLib.CreateSensorInstance(ME_SENSOR.SENSOR_IFD2411)
MEDAQLib_object = MEDAQLib.CreateSensorInstance(ME_SENSOR.SENSOR_IFD2422)

MEDAQLib_object.SetParameterString("IP_Interface", "TCP/IP");
MEDAQLib_object.SetParameterString("IP_RemoteAddr", "169.254.168.150");

#MEDAQLib_object.SetParameterString("IP_Interface", "RS232");
#MEDAQLib_object.SetParameterString("IP_Port", "COM15");
#MEDAQLib_object.SetParameterInt("IP_Baudrate", 921600);

MEDAQLib_object.SetParameterInt("IP_AutomaticMode", 3);

# Enable Logfile writing
MEDAQLib_object.SetParameterInt("IP_EnableLogging", 1)

# Try to open communication to sensor via interface specified
MEDAQLib_object.OpenSensor()

print(sys._getframe(0).f_lineno, ": MEDAQLib_object.GetLastError()) = ", MEDAQLib_object.GetLastError())

if MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR:
  print('Open ging schief ...')
  print('call exit()')
  exit()


print('Setup auslesen ...')
#MEDAQLib_object.ExecSCmd("Get_Setup")
#print(sys._getframe(0).f_lineno, ": MEDAQLib_object.GetLastError()) = ", MEDAQLib_object.GetLastError())

#SA_SensorAnswer = MEDAQLib_object.GetParameterString("SA_SetupRecord",2000000)


#print('disconnect power ...')
#key = input("Enter ")

#MEDAQLib_object.LogToFile(16,"Debug-String JKu","disconnect power of controller")

# 1. set the values
#... SetParamterDouble("SP_Measrate",2.0)
# 2. start/call the funcion
#... ExecSmd("Set_Samplerate")

#err = ... ExecSmd("Get_Samplerate")
#dRout = ...GetParamterDouble("SA_Measrate")

#print('try to call Get_OutputInfo_RS422 ...')
#MEDAQLib_object.ExecSCmd("Get_OutputInfo_RS422")
#print(sys._getframe(0).f_lineno, ": MEDAQLib_object.GetLastError()) = ", MEDAQLib_object.GetLastError())
#
#SA_SensorAnswer = MEDAQLib_object.GetParameterString("SA_SetupRecord",2000000)

#key = input("Enter")


#exit()

#print (SA_SensorAnswer)
#print('Setup in Datei schreiben ...')
#fdDatei = open('SA_SetupRecord_Get_Setup.txt','w')
#fdDatei.write(SA_SensorAnswer)
#fdDatei.close()

#print('Set_Setup ...')
#MEDAQLib_object.SetParameterString("SP_SetupRecord", SA_SensorAnswer)
#MEDAQLib_object.ExecSCmd("Set_Setup")

print(sys._getframe(0).f_lineno, ": MEDAQLib_object.GetLastError()) = ", MEDAQLib_object.GetLastError())

if MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR:
  print(sys._getframe(0).f_lineno, ": MEDAQLib_object.GetLastError()) = ", MEDAQLib_object.GetLastError())
  print('Set_Setup ging schief ...')
  print('call exit()')
  exit()

#print('Parameter gelesen und in Datei geschrieben')

#MEDAQLib_object.ExecSCmd("DarkCorr")

# If no error then try to acquire data
if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
    bDone = False
    #bDone = True 
    # hehe - hier raus
    while bDone is not True:
        # Check whether there's enough data to read in
        currently_available = MEDAQLib_object.DataAvail()
        # Check if DataAvail causes an Error
        if (MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR):
            print(MEDAQLib_object.GetError())
        # If data is available?
        if currently_available > 0:
            # Transfer/Move data from MEDAQLib's internal buffer to own buffer
            transfered_data = MEDAQLib_object.TransferData(currently_available)
            # Check if TransferData causes an error
            if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
                # contains original values form sensor
                raw_data = transfered_data[0]
                # contains scaled data values
                scaled_data = transfered_data[1]
                # get number of data values received, should be equal to currently_available
                nr_values_transfered = transfered_data[2]
                # output raw and scaled value of very first measurement
                print(f'{raw_data[0]}/{scaled_data[0]}')
                # do your computation on data ....
            else:
                # Print TransferData error
                print(MEDAQLib_object.GetError())
        # Sleep for 10 ms
        time.sleep(0.01)
else:
    # Print OpenSensor Error
    print(MEDAQLib_object.GetError())

print('ende ...')
key = input("Enter ")

# Closing down by closing interface and releasing sensor instance
MEDAQLib_object.CloseSensor()
MEDAQLib_object.ReleaseSensorInstance()
