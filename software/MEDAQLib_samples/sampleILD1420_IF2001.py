#
# This is a very simple sample following MEDAQLib.pdf section 4 Using MEDAQLib
#
# Please adjust to your setup (interface card and sensor used)
#

from MEDAQLib import MEDAQLib, ME_SENSOR, ERR_CODE
import time

# Tell MEDAQLib about sensor type to be used
MEDAQLib_object = MEDAQLib.CreateSensorInstance(ME_SENSOR.SENSOR_ILD1420)

# Tell MEDAQLib about interface to be used
MEDAQLib_object.SetParameterString("IP_Interface", "RS232")
MEDAQLib_object.SetParameterString("IP_Port", "COM27")

# Enable Logfile writing
MEDAQLib_object.SetParameterInt("IP_EnableLogging", 1)

# Try to open communication to sensor via interface specified
MEDAQLib_object.OpenSensor()

# If no error then try to acquire data
if MEDAQLib_object.GetLastError() == ERR_CODE.ERR_NOERROR:
    bDone = False
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

# Closing down by closing interface and releasing sensor instance
MEDAQLib_object.CloseSensor()
MEDAQLib_object.ReleaseSensorInstance()
