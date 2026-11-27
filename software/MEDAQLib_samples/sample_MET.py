#
# This is a very simple sample following MEDAQLib.pdf section 4 Using MEDAQLib
#
# Please adjust to your setup (interface card and sensor used)
#
# MET 
# JKu 24.06.2025
# V0.01
#


from MEDAQLib import MEDAQLib, ME_SENSOR, ERR_CODE
import time, re

# Tell MEDAQLib about sensor type to be used
MEDAQLib_object = MEDAQLib.CreateSensorInstByName("ME-Bus")

#MEDAQLib.GetDLLVersion()


# Tell MEDAQLib about interface to be used
MEDAQLib_object.SetParameterString("IP_Interface", "RS232")
MEDAQLib_object.SetParameterString("IP_Port", "COM25")
MEDAQLib_object.SetParameterInt("IP_SensorAddress", 126) 
MEDAQLib_object.SetParameterInt("IP_Baudrate", 115200) 

# Enable Logfile writing
MEDAQLib_object.SetParameterInt("IP_EnableLogging", 1)

# Try to open communication to sensor via interface specified
MEDAQLib_object.OpenSensor()

# If no error then try to acquire data
if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
    bDone = False

    MEDAQLib_object.SetParameterInt("SP_AveragingType",1)
    MEDAQLib_object.SetParameterInt("SP_AveragingValue",1)
    MEDAQLib_object.ExecSCmd("Set_Averaging")


    #MEDAQLib_object.ExecSCmd("Get_ConfigDescription")

    # Get_ConfigParameter
    #SA_ConfigDescription = MEDAQLib_object.GetParameterString("SA_ConfigDescription",2000000)
    #print (SA_ConfigDescription)
    #fdDatei = open('SA_ConfigDescription_SE.txt','w')
    #fdDatei.write(SA_ConfigDescription)
    #fdDatei.close()


    # Set Parameter
    #MEDAQLib_object.SetParameterInt("SP_ParameterID",50029)
    #MEDAQLib_object.SetParameterString("SP_Value","5")
    #MEDAQLib_object.ExecSCmd("Set_ConfigParameter")
    # Get_ConfigParameter
    # SP_ParameterID
    # SA_Value 
    #if (MEDAQLib_object.GetLastError() != ERR_CODE.ERR_NOERROR):
      #print(MEDAQLib_object.GetError())


    MEDAQLib_object.ExecSCmd('Get_TransmittedDataInfo')
    #IA_ValuesPerFrame number of values (signals) in one data transmission
    result = MEDAQLib_object.GetParameters(10000)
    print(result)
    print()
    signals_per_frame = MEDAQLib_object.GetParameterInt("IA_ValuesPerFrame")

    # Alle IA_Raw_Name-Werte finden
    raw_names = re.findall(r'IA_Scaled_Name(\d+)="([^"]+)"', result)

    names = [re.sub(r'\([^)]*\)', '', name) for index, name in raw_names]
    print('- '.join(names))
    print()


    # for exit ...
    #bDone = True

    while bDone is not True:
        MEDAQLib_object.ExecSCmd("Get_Measure")
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
                print(f'{scaled_data[0:signals_per_frame]}')
                # do your computation on data ....
            else:
                # Print TransferData error
                print(MEDAQLib_object.GetError())
        # Sleep for 10 ms
        MEDAQLib_object.SetDoubleExecSCmd("Exec_SleepTime","IP_SleepTime",10.0)
else:
    # Print OpenSensor Error
    print(MEDAQLib_object.GetError())

# Closing down by closing interface and releasing sensor instance
MEDAQLib_object.CloseSensor()
MEDAQLib_object.ReleaseSensorInstance()
