#
# This is a very simple sample following MEDAQLib.pdf section 4 Using MEDAQLib
#
# Please adjust to your setup (interface card and sensor used)
#
# DT3001
# JKu 15.05.2026
# V0.01
#


# Multisensor
# Zeitstemptel

from MEDAQLib import MEDAQLib, ME_SENSOR, ERR_CODE
import time, re
import datetime
import time

import configparser


#INITFILE = "DT3005.ini"

#config = configparser.ConfigParser()
#config.read(INITFILE)

# Tell MEDAQLib about sensor type to be used
#MEDAQLib_object = MEDAQLib.CreateSensorInstByName("ME-Bus")
MEDAQLib_object = MEDAQLib.CreateSensorInstByName("MultiSensor")

#MEDAQLib.GetDLLVersion()


###########################################################################

#if config['interface']['IP_EnableLogging'] == "1":


# Enable Logfile writing
MEDAQLib_object.SetParameterInt("IP_EnableLogging", 1)


MEDAQLib_object.SetParameters("""
  IP_Baudrate=512000
  IP_Interface=RS232
  IP_Port=COM42
  IP_SensorCount=1
  IP_SensorTypeName=ME-Bus
  IP_SensorAddress#1=41
  IP_SensorAddress#2=42
  IP_SensorAddress#3=44
  IP_SensorAddress#4=45
  IP_SensorAddress#5=46
""")

  #IP_SensorAddress#3=43

# Try to open communication to sensor via interface specified
MEDAQLib_object.OpenSensor()
if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
  print("open error")

MEDAQLib_object.ExecSCmd("Set_LatestSync")

# If no error then try to acquire data
if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
    bDone = False

    MEDAQLib_object.ExecSCmd('Get_TransmittedDataInfo')
    #IA_ValuesPerFrame number of values (signals) in one data transmission
    result = MEDAQLib_object.GetParameters(10000)
    print(result)
    print()
    signals_per_frame = MEDAQLib_object.GetParameterInt("IA_ValuesPerFrame")

    while bDone is not True:
        MEDAQLib_object.SetParameterInt("IP_SensorIndex",-1)
        # Messung der Laufzeit
        start_time = time.time()
        MEDAQLib_object.ExecSCmd("Get_Measure")
        # Check whether there's enough data to read in
        currently_available = MEDAQLib_object.DataAvail()
        end_time = time.time()
        #print(currently_available)
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
                #print(f'{scaled_data[0:signals_per_frame]}')
                print([round(x, 3) for x in scaled_data[0:signals_per_frame]])
                # do your computation on data ....
            else:
                # Print TransferData error
                print(MEDAQLib_object.GetError())
        diff_time = end_time - start_time
        print(f"{diff_time:.5f} s - {(1/diff_time):.1f} Hz")
        # Sleep ....
        #MEDAQLib_object.SetDoubleExecSCmd("Exec_SleepTime","IP_SleepTime",
            #int(config['interface']['SleepTime']))
else:
    # Print OpenSensor Error
    print(MEDAQLib_object.GetError())

# Closing down by closing interface and releasing sensor instance
MEDAQLib_object.CloseSensor()
MEDAQLib_object.ReleaseSensorInstance()
